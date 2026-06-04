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
| L2 | Jest ユニットテスト | ✅ | 4942 テスト全通過、208 スイート（2026-06-04、最高峰監査 watchdog/公開ゲート/webhook/payjp のテスト追加） |
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
- #G availability の per-date×per-staff RPC（最悪310往復）。集約RPC化が理想だが status導出ロジックが
  jestテスト済みJSから未テストのplpgsqlへ移りL3カバレッジが実質低下するトレードオフがあるため保留。
  既存は early-exit＋5日並列で典型ケースは緩和済み。
- 予約e2e #3 サーバ再計算した確定額がAPI応答/完了画面に返らず確認画面表示と乖離し得る（価格の保存・
  メール送信は正常＝データ不整合なし、UX改善事項）。

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
- customer-segment の RFM集計が2年2000件超の繁忙施設で頭打ち → email別集計RPC化（行数非依存）。
- Nextブログ予約投稿(scheduled_at)の時刻到来公開が ISR ラグを受ける → 予約時刻での revalidateTag 発火 or 短縮revalidate。

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
- salons 新規登録の承認ゲート（現状は登録即時 published の動線か要確認）
- 空施設（メニュー0件等）の公開ガード
- facility/初期セットアップの TOCTOU（同時オンボーディングの重複作成）

**🟢 推奨インデックス（性能・別タスク）:** facility_menus/photos の sort_order、reviews の created_at。

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
- オンボ: リード(salons)入力の施設への引き継ぎ / facility/setup の TOCTOU（1ユーザー=1施設か多対多かの仕様確定が前提）。
- SEO 2次: 施設詳細の全タブ HTML 描画 / ランキングページの ItemList・URL romaji 統一 / 空施設 noindex。
- a11y 2次: モバイル下部ナビ 44px・aria-current / gray-400 コントラスト / 極小フォント。
