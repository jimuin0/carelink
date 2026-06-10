# 外部検証 事前資料（ペネトレーション / 負荷 / コンプライアンス ベンダー向け）

本書は CareLink を第三者検証（外部ペンテスト・負荷試験・法令/コンプラ監査）に出すための事前資料。
内部レビュー（perfect-code 全網羅レビュー：routes/lib/XSS面/components 100%）で確認済みの事実に基づく。
数値・分類はリポジトリの grep / migration / workflow を確認して記載（推定箇所は明記）。

最終更新: 2026-06-10（main `4ef5f7e2` 時点）

---

## 1. 攻撃面マップ（Attack Surface）

### 1.1 API ルート規模（事実）
- 総ルート数: **127**（`src/app/api/**/route.ts`）
- CSRF 保護（`checkCsrf`）使用: **81 ルート**（GET 以外の状態変更系に適用）
- cron 認証（`checkCronAuth`・Bearer + timingSafeEqual）: **12 ルート**（`src/app/api/cron/*`）
- 外部 Webhook 署名検証: **4 ルート**
  - Stripe: `constructEvent`（payment/webhook・stripe/webhook）
  - LINE: `x-line-signature` HMAC-SHA256 + timingSafeEqual（line/webhook・auth/line/callback）
  - Slack: `verifySlackRequest`（slack/interactions）
- レート制限（`checkRateLimit` / `inMemoryRateLimit`）: **103 ルート**

### 1.2 認証境界
- ユーザー認証: Supabase Auth（`getUser()`）。`src/middleware.ts` が `/mypage`・`/admin` をサーバ側で保護し、`facility_members` の `owner/admin` ロールを検証。
- 施設管理者: `facility_members`（user × facility × role）。施設スコープは各 API で `.eq('facility_id', <検証済み>)` により IDOR を防止。
- プラットフォーム管理者: `is_platform_admin`（全体スコープの操作。registrations/moderation/backup/newsletter 等）。
- 外部 API（v1）: API キー（sha256 ハッシュ照合・is_active・expires_at・scopes・facility_id 固定）。

### 1.3 公開（未認証）エンドポイント（要重点ペンテスト）
GET 中心の公開面: `/api/salons`・`/api/stations`・`/api/facilities/suggest`・`/api/availability`・`/api/slots`・`/api/recommendations`・`/api/health`、および公開ページ（facility/[slug]、[prefectureSlug]/* 等の SSR）。
- 注: `/api/salons` は公開掲載（`is_public=true`）の連絡先（email/phone）を返す仕様（掲載プラットフォームとして想定範囲）。

### 1.4 既知の防御（内部レビュー済み・ペンテストで再検証推奨）
- インジェクション: PostgREST はパラメータ化（`.eq()/.in()` 等）。`.or()` フィルタへの生入力は `orFilterValue()` でエスケープ済み（facilities.ts）。
- XSS: `dangerouslySetInnerHTML` は全16箇所が `safeJsonLd` / 許可タグ式サニタイザ（SafeHtmlContent）/ 先頭エスケープ式マークダウン経由。Leaflet popup の格納型 XSS は修正済み（MapView）。
- 情報漏洩: catch は固定文言を返却、error.message/stack はクライアント非露出（サーバ側 Sentry/Slack のみ）。

---

## 2. 個人情報（PII）データフロー

### 2.1 PII を保持する主な列（migration 確認）
`email` / `phone` / `full_name` / `display_name` / `customer_name` / `customer_email` / `reviewer_name` / `reviewer_ip`。
PII 列を含む migration: **42 ファイル**。

### 2.2 主な保持テーブル（用途）
- `profiles`（display_name, email_unsubscribed 等・auth.users 1:1）
- `bookings`（customer_name, customer_email, total_price 等）
- `facility_inquiries`（問い合わせ者情報）
- `facility_reviews`（reviewer_name, reviewer_ip）
- `customer_segments`（RFM・customer_email）
- `newsletter_send_log` / `newsletter_campaigns`（配信先 email・本セッションで追加）

### 2.3 保存・保護
- 保存先: Supabase（Postgres・ref は本番環境変数管理）。
- アクセス制御: **RLS 有効テーブル 118**。cron / 管理 API はサーバ側 service_role（RLS バイパス）で、認可は各ルートのメンバーシップ/プラットフォーム管理者チェックに依存。
- 配信停止（特電法）: `NEWSLETTER_UNSUBSCRIBE_SECRET` の HMAC トークン + `email_unsubscribed` / `newsletter_subscriptions.is_active` で除外。
- 監査ログ: `writeAuditLog`（管理操作）。
- ※ 暗号化（保存時/通信）・データ保持期間・削除フロー（`/api/account/delete`）の十分性は**監査で要確認**（推定: Supabase 既定の保存時暗号化 + TLS だが、CareLink 固有の追加要件は未文書）。

---

## 3. 想定負荷・可用性

### 3.1 バッチ（cron）
- GitHub Actions スケジュール **11 種**（`*/15` webhook-retry 〜 月次 newsletter）。
- 月次 newsletter は専用 workflow で 1〜7 日 self-heal（GitHub best-effort スケジュールの単一 tick ドロップ対策）。
- 各 cron は `maxDuration=60` + 実時間予算ガード + fetchAllPaged で全件処理（silent 切り捨て・timeout を構造的に回避）。

### 3.2 外形監視
- `/api/health`（多依存・並列・各 1.5s タイムアウト・critical 依存はリトライ1回）。デプロイ直後の startup check は複数回リトライで cold-start 偽陽性を抑止。
- 月次バッチ監視 watcher（cron_logs を照会・day8 判定）。

### 3.3 負荷試験で確認すべき点（推定・未実施）
- 公開検索（salons/facilities/suggest/availability）の同時アクセス耐性。
- Supabase 接続プール上限・PostgREST db-max-rows(1000) を越える全件処理の応答時間。
- レート制限（Upstash Redis 優先 / in-memory フォールバック）の閾値妥当性。
- ※ 想定同時ユーザー数・ピーク TPS は事業計画に依存（未確定）。ベンダーに目標値を提示する必要あり。

---

## 4. ベンダー向けチェックリスト

### 4.1 ペネトレーションテスト
- [ ] 認証バイパス（middleware の保護ルート・API の getUser/getAdminInfo）
- [ ] IDOR（facility スコープ・他施設データ越境・予約/レビュー/顧客 PII）
- [ ] 公開 GET の情報過多露出（salons の連絡先範囲）
- [ ] Webhook 署名（Stripe/LINE/Slack）リプレイ・改竄
- [ ] XSS（SafeHtmlContent サニタイザのバイパス・Leaflet/SEO sink・ブログ HTML）
- [ ] PostgREST フィルタ/RPC インジェクション
- [ ] レート制限回避・列挙攻撃（unsubscribe HMAC・API キー）
- [ ] CSRF（Origin/Referer 検証の回避）

### 4.2 負荷・性能試験
- [ ] 目標同時数/TPS の提示 → 公開検索・予約フローの応答時間/エラー率
- [ ] Supabase 接続上限・スロークエリ
- [ ] cron 高負荷時の maxDuration/予算ガード挙動

### 4.3 コンプライアンス監査
- [ ] 個人情報保護法（取得・利用目的・保存・削除・第三者提供）
- [ ] 特定電子メール法（配信停止導線・送信者表示）
- [ ] 利用規約・プライバシーポリシーの整合（`/privacy`・`/terms`）
- [ ] Cookie 同意（CookieConsent）と GA4/Clarity の取り扱い

---

## 5. 既知の残リスク（正直な開示）

- **GitHub Actions スケジュールは best-effort**：月次など低頻度トリガーはドロップし得る。newsletter は self-heal + watcher で多層防御済みだが、他の低頻度 cron も同様の脆弱性を持つ可能性（要棚卸し）。
- **外部依存（Resend/Stripe/LINE/Places API）の一過性失敗**：fail-safe / リトライ / idempotency で緩和済みだが、SLA は各社依存。
- **L4 ミューテーション・L5 プロパティテストは限定スコープ**（純粋関数モジュールのみ）。全ルートで「テストが全退行を捕捉」は未証明。
- **外部ペンテスト・負荷・コンプラ監査は未実施**（本書はその準備資料）。
- **#53（feat 巨大ブランチ）未マージ**：その機能/コードは main 未反映・未レビュー。

---

## 6. 内部品質スタック（参考・達成済み）

| レベル | 内容 | 状態 |
|---|---|---|
| L1 | tsc / eslint | エラー 0 |
| L2/L3 | Jest ユニット + ブランチカバレッジ | 4601 tests・global branch 100% |
| L4 | Stryker ミューテーション | 限定（i18n/seo-constants/seo-snippets/json-ld。拡大中） |
| L5 | fast-check プロパティ | 限定 |
| L6 | npm audit / 認証テスト | critical・high=0 |
| L7 | 構造化ログ + Slack + 外形監視 | 達成 |

コードレビュー: perfect-code 全網羅（routes 127 / lib 53 / XSS面 16 / components 94）完了。
