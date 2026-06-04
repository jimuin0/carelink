# CareLink

## プロジェクト概要
医療・福祉・美容 特化型 採用×集客プラットフォームのLP・関連ページ一式。

## 技術スタック
- Next.js 14（App Router）
- TypeScript
- Tailwind CSS
- react-hook-form + zod（バリデーション）
- Supabase（@supabase/supabase-js）
- Vercel デプロイ

## ディレクトリ構成
```
src/
├── app/
│   ├── layout.tsx          # ルートレイアウト（Header/Footer/GA4/Clarity）
│   ├── page.tsx            # トップページ
│   ├── loading.tsx         # ローディング
│   ├── error.tsx           # エラー
│   ├── not-found.tsx       # 404
│   ├── sitemap.ts          # sitemap.xml
│   ├── robots.ts           # robots.txt
│   ├── salon/
│   │   ├── layout.tsx      # メタデータ
│   │   └── page.tsx        # 集客掲載LP（3ステップフォーム）
│   ├── jobs/
│   │   ├── layout.tsx      # メタデータ
│   │   └── page.tsx        # 求職者登録LP（3ステップフォーム）
│   ├── privacy/page.tsx    # プライバシーポリシー
│   ├── terms/page.tsx      # 利用規約
│   └── contact/page.tsx    # お問い合わせ
├── components/
│   ├── Header.tsx          # グローバルヘッダー
│   ├── Footer.tsx          # グローバルフッター
│   ├── FAQ.tsx             # アコーディオンFAQ
│   ├── Toast.tsx           # 通知トースト
│   ├── Spinner.tsx         # ローディングスピナー
│   ├── StepIndicator.tsx   # フォームステップ表示
│   └── PhotoUpload.tsx     # 写真アップロード（プレビュー付き）
├── lib/
│   ├── supabase.ts         # Supabaseクライアント
│   └── validations.ts      # zodスキーマ・定数
└── types/
    └── index.ts            # 型定義
```

## 環境変数
| 変数名 | 説明 |
|--------|------|
| NEXT_PUBLIC_SUPABASE_URL | Supabase Project URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase anon key |
| NEXT_PUBLIC_GA_ID | Google Analytics 4 測定ID（空なら無効） |
| NEXT_PUBLIC_CLARITY_ID | Microsoft Clarity プロジェクトID（空なら無効） |

## Supabaseテーブル設計

### salons
施設・サロンの掲載登録データ。
主要カラム: facility_name, business_type, representative_name, contact_name, email, phone, photo_url, status

### job_seekers
求職者の登録データ。
主要カラム: full_name, furigana, phone, email, job_type, certifications(TEXT[]), desired_employment_type(TEXT[]), photo_url, status

### contacts
お問い合わせデータ。
カラム: name, email, inquiry_type, message

### Storage
バケット: carelink-uploads（public）
パス: salons/[uuid]/photo.[ext], job_seekers/[uuid]/photo.[ext]

## デプロイ手順
1. GitHubリポジトリにpush
2. Vercelにインポート → 環境変数を設定
3. デプロイ完了

## 開発コマンド
```bash
npm run dev   # 開発サーバー起動
npm run build # ビルド
npm run lint  # ESLint
```

## テスト品質スタック 現在地

| レベル | 内容 | 状態 | 備考 |
|--------|------|------|------|
| L1 | ESLint / tsc | ✅ | エラー 0（2026-06-04 確認、最高峰受け入れ監査の根本対策反映後・本番ビルド891/891） |
| L2 | Jest ユニットテスト | ✅ | 4961 テスト全通過、208 スイート（2026-06-04、最高峰監査＋原機能品質＋受け入れ体制のテスト追加） |
| L3 | Jest ブランチカバレッジ 100% | ✅ | 変更・新規の全API/lib で branch 100% 維持（booking/availability/slots/menus/coupons/blog/reviews/customer-note/booking-suspension/daily-capacity/reorder/lib(blog,suspensions)）。2026-06-03 |
| L4 | Stryker ミューテーション | ✅ | 全12ファイル survived=0（2026-06-03、lib/suspensions.ts を追加し mutation score 100%）。lib/blog.ts は supabase IO ありで L4基準「外部副作用なし」非該当のため対象外。 |
| L5 | fast-check プロパティベース | ✅ | 31テスト全通過（db-fallback の isMissingColumnError/omitKeys プロパティ5件追加、2026-06-01） |
| L6 | npm audit / 認証テスト | ✅ | critical=0・high=0（moderate 5）、menu-remarks の認証/IDOR テスト追加（2026-06-01） |
| L7 | 構造化ログ + Slack + 外形監視 | ✅ | 2026-05-25 達成（A〜D 全基準） |

### 8観点監査 ラウンド4（2026-06-03）

8体エージェント＋統合で被らない8観点（並行性再検査 / React hooks / N+1 / 認可横断 / 参照整合 / round3回帰 / 予約e2e / 表示境界）を監査。
認可横断・参照整合FK・round3回帰の3観点は指摘なし（健全確認）。確認した12件のうち10件を根本修正済み・2件は判断保留で記録。

**修正済み（発症前の恒久対策）:**
- #A クーポンのメニュー限定(coupon_menus)を確定層で検証（対象外メニューへの不正割引を防止）
- #B クーポン種別(new_customer/repeat)の対象者検証を確定層に追加
- #C service_packages.menu_id の参照先を facility_menus に是正（ソース＋冪等是正マイグレーション）
- #D ListingBoard コールバックを useCallback 安定化（60秒タイマー由来の掲載6テーブル無駄再取得を解消）
- #E /api/slots の suspensions+capacity を並列化
- #F お客様一覧をサーバ集計RPC化（PostgREST 1000行上限の集計欠落を解消）
- #H 管理予約RPCに施設×日 advisory lock（capacity超過の理論窓を封鎖）
- #I 注目口コミPickUpを施設lock下の原子RPC化（並行PATCHの0件/2件競合を排除）
- #J reorder RPCに施設×テーブル advisory lock（並行reorderの交錯防止）
- #K rangeBookings の section ガード / 顧客フィルタ空状態 / hpbLen 半角カナ0.5換算

**判断保留（神原さん確認待ち・事実として未修正）:**
- ~~#G availability の per-date×per-staff RPC（最悪310往復）~~ → ✅ 解消済み（集約RPC `get_month_availability`
  を新設。日数×スタッフの集計を1往復に。同RPCは内部で既存 `get_available_slots` に委譲＝空き判定は
  単一ソースのまま分裂なし。status導出は JS に残しテスト維持。未適用/失敗時は従来 per-date ループに
  自動フォールバック（無退行）。route branch100%・両経路テスト済み。migration `20260607_get_month_availability.sql`）。
- ~~予約e2e #3 サーバ再計算した確定額がAPI応答/完了画面に返らず確認画面表示と乖離し得る~~ → ✅ 解消済み
  （API応答に totalPrice/subtotal/pointsApplied を返し、完了画面は DB の権威確定額を表示。`4e7d1d9`）。

**✅ マイグレーション適用済み（2026-06-03・Supabase SQL Editor で "Success. No rows returned" 確認）:**
1. `20260604_facility_status_gate.sql` / `20260604_booking_status_cancel_fee.sql` / `20260604_daily_capacity_dedup_index.sql`（round3）
2. `20260604_service_packages_menu_fk_fix.sql`（#C・既存環境向け是正）
3. `20260604_concurrency_hardening.sql`（#H/#I/#J）
4. `20260604_facility_customers_rpc.sql`（#F）
→ 本番でフォールバックではなく本来の RPC・advisory lock・確定層ゲートが有効。

### 8観点監査 ラウンド5（2026-06-03）

8体エージェント＋統合で被らない8観点（決済webhook / 通知副作用 / zod入力境界 / 時刻TZ全域 / RLS実体 /
トランザクション部分失敗 / 金額計算 / 予約状態機械）を監査。RLS実体は健全確認（残 referral_codes Low 1件）。

**修正済み（発症前の恒久対策・push済み）:**
- 🔴 cancel_fee_paid を占有判定から除外し枠解放（真の予防）。SQL `booking_status_occupies()` 関数＋
  アプリ `NON_OCCUPYING_STATUS_FILTER` 定数に占有判定を一元集約（今後のステータス追加に追従）。
- Stripe webhook の cancel_fee を `status='cancelled'` ガード（状態遷移マシン迂回を封鎖）
- キャンセル料 daysUntil を JST暦日差に是正（UTC起点の料率1段ズレ＝金銭）
- 予約変更API に JST過去日/上限/暦上不正日ガード追加（作成APIと対称化）
- webhook-retry の配信後例外を再送対象外化（二重配信防止）
- 施設検索 .or() フィルタ注入を無害化（getFeaturedFacilities type/area・searchFacilities keyword）
- L4衛生: storage-cleanup.test の jest env を Stryker mixin に統一（ドライラン破壊の取りこぼし是正）

**✅ マイグレーション適用済み（round5分・2026-06-03 "Success. No rows returned" 確認）:** `20260604_cancel_fee_paid_slot_release.sql`（占有判定一元化）

**追加修正済み（2026-06-03・神原さん「残りの確定バグを全部修正」指示）:**
- 🔴 account削除の部分失敗で孤児PII → 部分失敗時は auth.users を消さず500（冪等再実行で完遂）
- 🟡 group-booking 部分失敗 → 補償削除でロールバックして500
- 🟡 waitlist-notify 送信失敗で通知喪失 → claim を waiting に戻し次回再通知
- 🟡 accounting-export 存在しない列(total_amount/menu_name)で500 → 実列(total_price/customer_name/menu結合)に是正＋テストモックも実スキーマ化
- 🟢 referral_codes 公開読取 → 20260420 で既にDROP済み（誤検知・是正済み確認）
全API branch100%維持・131テスト通過。

**判断保留（PAY.JP 移行で解消予定）:**
- 🔴 Stripe webhook 2系統分裂 → PAY.JP 移行（同期課金で webhook 依存が消える）で構造的に解消するため Stripe個別修正は記録のみ。[[payjp-migration-pending]]

### 8観点監査 ラウンド6（2026-06-03）

8体エージェント＋統合で被らない8観点（例外握りつぶし / Nextキャッシュ整合 / 暗黙行上限 / 入力正規化・重複 /
認証セッション境界 / アップロード境界 / カウンタ並行更新 / SSRF・ログPII）を監査。
認証セッション境界・カウンタ並行更新・SSRF の3観点は健全確認（既存対策が保持）。確認した全件を根本修正。

**修正済み（発症前の恒久対策・全push済み）:**
- 🔴 予約ポイント控除 insert/recheck の error 握りつぶし → 失敗時は予約取消で整合維持（値引き＋ポイント据え置きの二重特典防止）
- 🟡 入力正規化の非対称（最良の真の予防・1原因→3症状一掃）: bookingSchema の email を保存時小文字化・name trim。
  既存是正マイグレーション 20260604_normalize_booking_email.sql。クーポン二重取得・顧客分裂・属性突合漏れを解消。
- 🟡 行上限(PostgREST 1000)取りこぼし: LIFFポイント残高(全件SUM RPC)・accounting-export/backup/newsletter/flag-reviews/
  getMonthlyBookingCounts を .range() 全件ページング化（共有 lib/paginate.ts）。
- 🟡 Nextキャッシュ陳腐化: 公開ページ on-demand 再検証を lib/revalidate.ts に集約し、施設の公開/非公開＋
  メニュー/クーポン/スタッフ/写真/ブログの全 create/update/delete から呼び出し（最大1時間の陳腐化を解消）。
- 🟡 クーポン image_url スキーム検証欠落 → blog の IMAGE_URL を lib/image-url-schema.ts に共通化し横展開。
- 🟢 アバターMIME検証/アップロード拡張子のfile.name依存排除/customer-segment のPIIログマスク/middlewareコメント是正。

**✅ マイグレーション適用済み（round5/6・2026-06-03 "Success. No rows returned" 確認）:**
`20260604_cancel_fee_paid_slot_release.sql` / `20260604_payjp_charge_column.sql` /
`20260604_normalize_booking_email.sql` / `20260604_user_points_balance_rpc.sql`
→ round3〜6 の全マイグレーション適用完了。cancel_fee_paid 占有解放・email正規化・残高SUM RPC・payjp列が本番で有効。

**残課題（根本解決の方向性は確定・別タスク）:**
- ~~customer-segment の RFM集計が2年2000件超の繁忙施設で頭打ち~~ → ✅ 解消済み（`.limit(2000)` を
  fetchAllPaged 全件ページングに置換。切り捨てなくRFM算出。全ロジックはテスト済みJSのまま・branch100%維持）。
  さらなる性能最適化(email別集計RPC)は correctness 解消後の任意事項。
- ~~Nextブログ予約投稿(scheduled_at)の時刻到来公開が ISR ラグ(最大1時間)を受ける~~ → ✅ 解消済み
  （cron `publish-scheduled-blog` を15分周期で新設。直近に scheduled_at が到来した施設ブログを
  revalidateFacilityBlog で on-demand 再検証し遅延を cron 間隔に短縮。全ブログ流入の revalidate は
  3600s 維持＝性能退行なし。watchdog 監視対象にも登録。cron/revalidate とも branch100%）。

### 決済プロバイダ移行 Stripe → PAY.JP（2026-06-03 着手・神原さん方針）

PAY.JP はホスト型リダイレクト決済が無く「クライアントでトークン化→サーバ `charges.create` 同期課金」型。
Stripe を温存したまま PAY.JP 経路を併設して段階移行する。

- ✅ Phase 0 基盤: `payjp@3.1.2` 導入、`src/lib/payjp.ts`（getPayjp/PAYJP_SECRET_KEY 未設定なら null）
- ✅ Phase 1 予約事前決済: `POST /api/payment/payjp/charge`（token→同期課金→payment_status=paid 確定）。
  migration `20260604_payjp_charge_column.sql`（bookings.payjp_charge_id 加算）。branch100%。
- ⏭️ キャンセル料: 神原さん指示でスキップ
- ✅ Phase 3 有料広告: featured-ads POST に token 同期課金（成立で is_active=true・失敗でスロット削除）。branch100%。
- ✅ Phase 4a 領収書: `GET /api/payment/payjp/receipt?bookingId=`（bookings由来）。HTML を `lib/receipt-html.ts` に
  共通化し stripe/receipt も同ライブラリへ統一。branch100%。
- ⏭️ Phase 4b webhook(非同期: 返金/サブスク): 現状フローは同期課金で確定するため未実装（返金/キャンセル料/
  サブスク導入時に追加）。
- 🔲 Phase 5 Stripe撤去: ライブ検証後に実施（検証前に撤去すると本番決済が壊れるため保留）。

移行済みサーバフロー（booking/ads/receipt）はいずれも logic をモックテストで branch100% 担保。実鍵・
クライアント payjp.js 連携・テストモード実機決済は未実施（GO LIVE 前ゲート）。

**🔴 GO LIVE 前ゲート（神原さん）:** ①PAYJP_SECRET_KEY・公開鍵を本番/テスト環境変数に設定（会話に貼らない）
②クライアント payjp.js 連携（決済UI）③テストモードで実機決済1本を確証（→確証後に Phase3〜5 を複製）

### 多店舗スケール受け入れ監査（2026-06-03・神原さん「一気に10〜20社増えたときの受け入れ体制」）

8体エージェント＋統合で「同時に10〜20施設を受け入れる」観点（schemaドリフト / 一括操作 / 行上限
スケール / ISR反映 / テナント分離 / オンボーディング動線 / インデックス / 権限モデル）を監査。
テナント分離（IDOR/RLS/authz）は健全確認。確定バグを根本修正・push済み。

**修正済み（発症前の恒久対策・push済み 2994611）:**
- 🔴 chain/bulk-publish が `is_published` のみ更新する no-op（read経路は `status='published'`）→
  `status` を権威カラムとして更新＋slug取得＋施設別ISR再検証。一括公開が実際に効くように。
- 🔴 profiles.role / is_platform_admin が code/RLS で37回参照されるのにマイグレーション未追加（schema
  ドリフト）→ 冪等・非破壊 `20260604_profiles_admin_columns.sql`（ADD COLUMN IF NOT EXISTS）。
- 🟡 daily-summary / customer-segment(.limit200) / sitemap の施設取得が PostgREST 1000行上限で欠落
  → 全件 fetchAllPaged 化（施設1000超でも集計・SEO漏れなし）。
- 🟡 admin/settings の公開状態・基本情報更新が公開ページ(ISR)へ即時反映されない → revalidateFacilityById
  を status分岐・本体更新の両方に追加。
全変更ファイル branch 100%・tsc/eslint 0・全4920テスト通過。

**✅ マイグレーション適用済み（2026-06-03・Supabase SQL Editor "Success. No rows returned" 確認）:**
`20260604_profiles_admin_columns.sql`（profiles.role / is_platform_admin / idx_profiles_platform_admin。
冪等・非破壊のため本番は no-op、migration からの新環境構築でも列不在エラーが起きなくなった）。

**🟡 要件依存・神原さん判断待ち（仕様決定が必要なため未実装）:**
- 施設ごとの機能フラグ / プラン・課金枠（quota）/ スタッフ権限ロールの多段化
- ~~salons 新規登録の承認ゲート~~ → ✅ 決定済み（自己公開維持＋公開ゲート内容強化。line 308-312 参照）
- ~~空施設（メニュー0件等）の公開ガード~~ → ✅ 解消済み（公開ゲートが住所+電話+紹介文+メニュー1件+写真1枚を必須化。line 308-312）
- ~~facility/初期セットアップの TOCTOU~~ → ✅ 解消済み（本番が多対多モデルと確定。setup を .limit(1).maybeSingle() に是正し重複作成防止。`3f40de6`）

**🟢 推奨インデックス（性能）:** → ✅ 追加済み（migration `20260607_recommended_indexes.sql`）。
facility_menus/photos に `(facility_id, sort_order, created_at)` 複合索引、facility_reviews に
`(facility_id, created_at DESC)` フル索引（既存 published 部分索引は管理一覧の全ステータス並びに効かないため）。
冪等・非破壊。staff_profiles も同一並びパターンだが #5 文書スコープ外のため未追加（要承認で追加可）。

### 最高峰受け入れ監査（2026-06-04・神原さん「提供サービスとして最高峰か」）

8体エージェント＋統合で被らない8観点（予約UX / 店舗運用 / 集客SEO / 機能パリティ / 信頼性 /
オンボーディング / a11y / セキュリティ法令）を監査。全観点「土台は最高峰級だが未達」と判定。
神原さん指示「🔴を全て根本修正」→確定バグを発症前の恒久対策で全修正。さらに「🔧バグだけ先に全修正」
指示で #3/#6 の明確な配線バグを修正、🧩機能追加（要仕様判断）は別タスクとして記録。

**🔴 修正済み（発症前の恒久対策・全push済み）:**
- 🔴#1 新規施設が作成できない確定バグ: facility_profiles.prefecture/city/address の NOT NULL を
  draft 作成時 NULL 許容に緩和し、住所必須化を「公開ゲート」に一元化（住所+メニュー1件を公開条件に。
  空施設公開ガード・検索未ヒット公開も同時解消）。`ad0e555`
- 🔴#5a webhook 二重配信・永久喪失: アトミック claim（status='pending' ガード＋RETURNING）＋
  delivered_at を冪等性境界にした孤児 reaper＋dead-letter/cron 致命例外の能動 Slack 通知。`9274abf`
- 🔴#5b PAY.JP 課金後の金銭不整合: DB更新リトライ→全失敗で自動返金→返金も失敗時のみ 🔴 能動通知。`e208543`
- 🔴#5c cron 未発火/失敗の能動監視: GET /api/cron/watchdog 新設（全cronの最終成功を cron_logs から
  監視し許容経過超過で Slack 通知。L7-C を月次1本→全cron化）。cron.yml に毎時実行追加。`7fd4bf8`
- 🔴#2 集客の内部リンクが配信HTMLに無い: HomeBelowFold の ssr:false 解除＋Footer の全リンク常時
  HTML出力（CSS開閉）。数百〜数千の地域×業種ページにリンク資産が伝わるように。`905e830`
- 🔴#4 法令: ConsentedAnalytics 新設で GA4/Clarity を同意ゲート化（consent-washing 解消・Clarity は
  marketing 同意必須で医療PII無断録画を防止）＋問診票に要配慮個人情報の取得同意UI（個情法20条2項）。`664358c`
- 🔴#7 a11y: 予約/登録フォームの検証エラーにフォーカス移動＋aria-invalid/aria-describedby 連動
  （高齢者・障害者の予約完遂不能を解消・WCAG 3.3.1/2.4.3）。`2a0a1ab`
- 🔧#3/#6 配線バグ: 問診票バナー(has_intake)配線・台帳のシフト設定ボタンを既存編集画面
  /admin/staff へ接続・台帳の bookings リアルタイム自動反映。`06fdae1`

各修正は branch 100%（API/lib）・tsc/eslint 0・全4942テスト通過。SSR/法令/UI 変更は本番ビルド
891/891 でも検証。watchdog/公開ゲート/webhook/payjp に branch100% テスト追加。

**✅ マイグレーション適用済み（2026-06-04・Supabase SQL Editor "Success. No rows returned" 確認）:**
1. `20260604_facility_location_nullable.sql`（#1・prefecture/city/address を DROP NOT NULL）
2. `20260604_webhook_retry_claim.sql`（#5a・claimed_at/delivered_at 追加＋processing バックログ解放＋index）
→ draft施設の住所NULL作成・webhook のアトミックclaim/孤児reaper が本番で有効。

**🧩 機能追加（要仕様判断・神原さん判断待ち・別タスク）:**
- #3 運用: 台帳グリッドに staff_schedules（出勤/休み/勤務時間）を反映しグレーアウト表示。
- #6 予約UX: 日付カレンダーの空き ○△× 表示 / 満枠時のキャンセル待ち動線 / メニュー・スタッフからの選択持ち越し。
- 機能パリティ: 店舗内POS・レジ締め(対面会計) / スタイル写真ギャラリー(作品カタログ)。
- オンボ: ~~リード(salons)入力の施設への引き継ぎ~~ → ✅ 実装済み（`55aab85`）。~~facility/setup の TOCTOU~~ → ✅ 多対多確定・是正済み（`3f40de6`）。残: 複数施設オーナーの「新店追加」動線は未整備。
- SEO 2次: ランキングページの ItemList・URL romaji 統一 / 空施設 noindex。
- a11y 2次: gray-400 コントラスト / 極小フォント（広域CSSのため実機QA推奨）。

### 原機能品質向上ラウンド（2026-06-04・神原さん「新機能もいいが原機能の品質も上げて」）

監査で挙がった 🟡 既存機能の品質バグを恒久対策（全 push 済み）:
- 🟡 予約UX: 確認画面サマリーの「合計金額」がポイント控除前で下部「お支払い金額」と齟齬 → サマリーに
  控除行＋確定額を集約し1か所統一。`873ca7e`
- 🟡 信頼性(health): 現用 PAY.JP・写真/PII保存先 Storage を未probe（旧Stripeのみ）→ probePayjp/
  probeStorage 追加・未設定の決済プロバイダは skipped で degraded 扱いにしない。`873ca7e`
- 🟡 信頼性(backup): 20万行サイレント切り捨てを完全BK誤認 → truncated 検知＋ヘッダ＋alertWarning。`873ca7e`
- 🟢 テスト衛生: jest.setup の偽SLACKトークンで webhook テストが実Slackへfetch試行 → alert モック化。`873ca7e`
- 🟡 予約UX: 電話番号クライアント未検証(汎用400で離脱) → サーバ同一regexで事前検証＋フォーカス/aria連動。`2247fcd`
- 🟡 a11y: モバイル下部ナビ 44px化・aria-current・svg aria-hidden・極小フォント緩和。`2247fcd`
- 🔴 確定データ不整合: Footer「堺市」 vs 特商法ページ「豊中市」（神原さん確認: 堺市が誤り）→ constants.OPERATOR
  に単一定数化し統一。広告メールに送信者氏名・所在地・受信拒否導線を明記（特定電子メール法4条）。`63f9a98`
- 🟡 SEO: 施設詳細がアクティブタブ1枚のみHTML描画 → lazy フラグ導入。サーバ描画タブ(menu/staff/catalog/
  coupon/medical/access)は常時HTML描画(SEO化)、クライアント取得タブ(QA/口コミ)のみ lazy で性能退行ゼロ。`1ee20c7`

health/backup branch 100%・tsc/eslint 0・全4947テスト通過(leak 0)・本番ビルド 891/891。

### 受け入れ体制 整備ラウンド（2026-06-04・神原さん「先に受け入れられる体制を整えて」）

新規オーナーが詰まらず・締め出されない動線を恒久対策（全 push 済み）:
- 🟡 リード引き継ぎ: register の salons リッチデータ（写真/PR/営業時間/席数/特徴/住所等）を facility/setup で
  全項目引き継ぎ。必須項目補完＋会員作成後に best-effort enrichment（拡張カラムは db-fallback）＋写真を
  facility_photos へ。プレースホルダ"未設定の施設"もリード名で置換。`55aab85`
- 🟡 setup 複数施設オーナー対応（当初の TOCTOU 想定を本番データで是正）: 当初「1ユーザー=1施設」と推測し
  owner 部分ユニーク索引で DB 保証する方針(`53ae2a5`)だったが、本番データで `user_id=d90f83a6` が
  **owner として3施設（ハル豊中本店/ハルイマイビル店/訪問専門 神原鍼灸院・いずれも published・別メニュー）を
  正当に運営する多対多モデル**であることが判明。索引はこのオーナーを壊すため撤回(`git rm`)。真の不具合は
  setup の existing チェック `.maybeSingle()` が2行以上で error→`existingMember` null→重複作成する点。
  → `.limit(1).maybeSingle()` に是正し、複数所属でも「既存あり」と判定して重複作成を防止。memberError 時は
  作成済み施設を補償削除して 500（孤児行防止）。middleware は `.limit(1).single()`、admin/layout は配列受けで
  複数施設を既に許容済み（締め出しなし）。本番監査ラウンドで確認・是正。

**✅ 承認運用 決定済み（神原さん: 自己公開維持＋公開基準を内容面で強化）:** 運営承認ゲートは設けず
オーナーの自己公開を維持。代わりに公開ゲート（admin/settings action=status published）を強化し、
「最低限まともな公開リスティング」を必須化 — 住所 + 電話番号 + 施設紹介文(description か catch_copy) +
メニュー1件 + 写真1枚(main_photo_url か facility_photos)。register のリッチ登録は引き継ぎ済みデータで
自動充足、素登録のみ内容補完が必要。未充足は公開時 400 で不足項目を返し管理画面に表示。`7945e66`

**現在のテスト規模:** 全4972テスト/208スイート通過（leak 0）。

### 本番提供可否監査（2026-06-04・神原さん「他者に提供できる最高品質か」）

8体エージェント＋統合で本番提供可否を監査（予約e2e/オーナー運用/金銭計算/エラーUX/データ整合/
セキュリティ/通知メール/本番設定）。セキュリティ＝健全確認。確定バグを根本修正（push済み）:

**🔴 修正済み:**
- 🔴 複数メニュー予約が1件しか記録されない（料金は合計請求）→ bookings.menu_ids 追加＋全層表示。`9978ecc`
  migration `20260605_booking_menu_ids.sql`。
- 🔴 ポイント過剰控除（クーポン後変更で再クランプ無し）→ サーバ pointsApplied=min(要求,確定額)クランプ＋
  クライアント整合。`e47b6fa`
- 🔴 キャンセルでポイント未返却 → 冪等(booking_id 部分ユニーク)返却。`e47b6fa`
- 🔴 配信停止オーナーにニュースレター再送（特電法）→ 全件ページングで除外。`e47b6fa`
- 🔴 キャンセル待ち通知喪失（email無し/LINEのみ）→ 通知手段で claim 分岐＋LINEフォールバック＋revert。`e47b6fa`
- 🔴 Google カレンダー OAuth の NEXT_PUBLIC_APP_URL 未設定で常時失敗 → デフォルト付与。`e47b6fa`

**✅ 🟡も全て修正済み（順次 push）:**
- リマインダー: 全件ページング＋メニュー/担当名表示。`35737c7`
- 誕生日/お気に入り: 全件ページング＋誕生日は配信停止者へのメール抑止。`b5490ab`
- PAY.JP 二重課金窓: 課金前に payment_status を原子的 claim。`af0e9e8`
- register 住所不整合: setup の address 保存を settings と同じ 100字上限に。`baa99b7`
- マイページ取得失敗の誤表示: サーバ3ページは error→error.tsx境界、client詳細は maybeSingle＋再試行。`baa99b7`
- migration 再定義順(#13): 占有判定RPCの権威版を最後ソートの 20260606 で再適用（fresh push 退行防止）。`393a6ea`

**✅ マイグレーション適用済み（2026-06-04・Supabase SQL Editor "Success. No rows returned" 確認）:**
- `20260605_booking_menu_ids.sql`（bookings.menu_ids・複数メニュー保存）→ 適用完了。複数メニュー予約が
  全件保存・全層表示されるように。

**🟡 任意（推奨・冪等）:** `20260606_booking_occupancy_authoritative.sql`（占有判定RPC権威版の再適用。
本番は適用済みのため任意。fresh db push 時の退行防止用）。

※ `20260604_facility_members_owner_unique.sql` は撤回（本番が多対多モデルと判明したため。上記「setup 複数施設
オーナー対応」参照）。`location_nullable`/`webhook_retry_claim` は 2026-06-04 適用済み（line 263-265）。

→ 本番監査で見つかった確定バグ（🔴6・🟡6）は全て根本修正済み。全4975テスト/208スイート通過。

**🔴 提供前ゲート（神原さん・コードでは閉じられない）:** ①上記マイグレーション適用 ②実機で
オンボーディング→公開→予約→決済の通し確認 ③PAY.JP テストモード実機決済1本。これらの実機検証なしに
「提供できる最高品質」とは断言不可（指針7: 再現性100%）。
