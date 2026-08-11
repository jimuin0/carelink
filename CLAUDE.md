# CareLink

## プロジェクト概要
医療・福祉・美容 施設向けの【予約管理・集客・採用】を統合したマルチテナント SaaS（旧 LP から予約管理プラットフォームへ移行済み）。施設オーナーが予約枠・メニュー・スタッフ・クーポンを管理し、来院者は施設検索・予約・問診・レビューを行う。決済は Stripe、メッセージングは LINE / LIFF、メールは Resend を使う。

- フロント／API＝Next.js 15（App Router・Route Handler）/ デプロイ＝Vercel（本番 `https://carelink-jp.com`・`www.` はアペックスへ 301）
- DB／認証＝Supabase（Postgres・Auth・Storage・RLS・RPC）
- 定期実行＝【Render Cron Jobs が実質の本番スケジューラ】（`render.yaml`・16 サービス）。GitHub Actions cron（`.github/workflows/cron.yml`）も残置しているが GitHub の間引きで実質ほぼ発火しない（下記「cron の現状」参照）。いずれも `/api/cron/*` を Bearer 認証で叩く。オーナーニュースレターの自動月次配信は廃止（神原さん確定 2026年7月2日「お知らせがある時のみ」）＝digest エンドポイント・専用ワークフロー・発火監視をすべて削除。配信は管理画面 `/admin/newsletters` からの手動送信のみ
- 本番 Supabase project ref＝`xzafxiupbflvgbarrihe`（middleware の CSP connect-src に明記）

## 技術スタック
- Next.js 15.5（App Router）/ React 18 / TypeScript 5
- Tailwind CSS 3.4
- react-hook-form 7 + zod 4（バリデーション）
- Supabase＝`@supabase/supabase-js` 2 + `@supabase/ssr`（SSR Cookie 認証）
- 決済＝Stripe（`stripe` / `@stripe/stripe-js`）
- メッセージング＝`@line/liff`（LIFF）・LINE Messaging API・LINE WORKS
- メール＝Resend / Web Push＝`web-push`（VAPID）
- 地図＝Leaflet + `@react-map/japan` / グラフ＝Recharts / QR＝`qrcode`
- AI＝`@anthropic-ai/sdk`（問い合わせサポート等）
- 解析＝`@vercel/analytics` / `@vercel/speed-insights` / GA4 / Microsoft Clarity
- テスト＝Jest 30（jsdom）・Playwright（E2E）・Stryker 9（ミューテーション）・fast-check（プロパティ）・k6（負荷）
- Lint＝ESLint 8 + `eslint-config-next` + 自作 `eslint-plugin-carelink-safety`
- pre-commit＝husky + lint-staged（`gitleaks protect` でシークレット流出防止）

## ディレクトリ構成
```
src/
├── middleware.ts            # CSP(nonce) 付与・/mypage・/admin 認証・admin membership キャッシュ
├── app/
│   ├── layout.tsx           # ルートレイアウト
│   ├── page.tsx             # トップ
│   ├── search/ compare/ ranking/ facility/ symptom/ symptom-checker/  # 来院者向け検索・比較・施設詳細
│   ├── mypage/              # 予約者マイページ（要認証）
│   ├── admin/               # 施設オーナー／プラットフォーム管理画面（要認証）
│   ├── auth/                # ログイン・サインアップ
│   ├── liff/ intake/        # LINE LIFF・問診フォーム
│   ├── blog/ feature/ recruit/ jobs/ register/  # 集客・採用・記事
│   ├── robots.ts sitemap.ts # SEO
│   └── api/                 # Route Handler 群（下記「API ルート一覧」）
├── components/              # UI コンポーネント
├── lib/                     # 共通ロジック（withRoute・各種 supabase クライアント・csrf 等）
└── types/                   # 型定義
supabase/migrations/         # DB マイグレーション（145 本）
.github/workflows/           # CI（ci.yml 他）・cron（cron.yml）
load-tests/                  # k6 負荷テスト
e2e/                         # Playwright E2E
```

## セキュリティ・共通パターン（必ず踏襲）

### API ルートの標準形＝`withRoute`（`src/lib/with-route.ts`）
Route Handler は原則 `withRoute` で包む。内部で以下を【この順序】で実行し、書き忘れを物理的に防ぐ：
1. CSRF 検証（`csrf` 既定 true・GET は false 指定）— `checkCsrf`：Origin/Referer の host が一致しなければ 403
2. レート制限（`rateLimit` 指定時）— `checkRateLimit`：Supabase RPC `check_rate_limit` を優先、失敗時は in-memory フォールバック（fail-safe・本体を 500 化させない）
3. 認証（`requireAuth: true` 指定時）— `auth.getUser()` で未認証は 401・通過時は `ctx.user` / `ctx.supabase` をハンドラへ注入
4. ハンドラ本体
5. 例外は必ず catch して 500 に変換し、`safeCaptureException` ＋ `alertCaughtError`（Slack 通知・fire-and-forget）。catch して 500 を返すと `instrumentation.ts` の onRequestError に伝播せず Slack 通知が漏れるため、catch 経路でも明示通知する。

### middleware（`src/middleware.ts`）
- 全応答に per-request nonce ベースの CSP を付与（`'strict-dynamic'` + nonce で `'unsafe-inline'` を script から排除）。`x-nonce` / `x-pathname` をサーバーコンポーネントへ伝搬。
- 保護パス＝`PROTECTED_PATHS = ['/mypage', '/admin']`。未認証は `/auth/login?redirect=...` へ。
- `/admin` は `facility_members` の `owner`/`admin` ロールのみ許可。`/admin/onboarding` は除外（施設未作成オーナーの作成導線を確保）。
- admin メンバーシップは Cookie キャッシュ（キー `_cm_mbr_{userId16}`・値を `ADMIN_COOKIE_SECRET` で HMAC-SHA256 署名・TTL 300 秒）。未設定時はキャッシュ無効（DB 都度確認）。

### cron 認証（`src/lib/cron-auth.ts`）
`checkCronAuth`：`Authorization: Bearer ${CRON_SECRET}` を `timingSafeEqual`（定数時間・長さ不一致は別途 false）で検証。`CRON_SECRET` 未設定は 500。

### 監査ログ（`src/lib/audit-logger.ts`）
重要操作は `void writeAuditLog({...})`（fire-and-forget・失敗で本体を止めない）で `audit_logs` に記録。`diffValues` で変更フィールドのみ抽出。

### Supabase クライアントの使い分け
- `createServerSupabaseClient`（`supabase-server.ts`）＝anon。公開データの読み取り専用。書き込み・ユーザー固有データに使わない。
- `createServiceRoleClient`（`supabase-server.ts`）＝service role。RLS バイパス。API ルート・cron などサーバー信頼文脈のみ。
- `createServerSupabaseAuthClient`（`supabase-server-auth.ts`）＝SSR Cookie 認証。ログインユーザー文脈の読み書き。
- ブラウザ＝`supabase-browser.ts`。

## API ルート一覧（`src/app/api/`）
- 公開・来院者系：`facilities` `facility` `salons` `availability` `slots` `booking` `waitlist` `options` `symptoms` `stations` `recommendations` `ab-test` `referral` `review` `nps` `report` `favorites` `profile` `account` `chat` `intake` `contact` `inquiry` `unsubscribe` `health` `og` `v1`
- 認証・LINE：`auth` `liff` `line` `push` `notify`
- 決済：`payment` `stripe`
- 管理（`api/admin/`・施設オーナー／プラットフォーム）：`bookings` `booking-status` `booking-checkout` `booking-adjust-request` `customers` `staff` `menus` `catalog` `coupons` `packages` `user-packages` `subscription-plans` `user-subscriptions` `payments-settings` `accounting-export` `settings` `facility-verify` `registrations` `jobs` `job-applications` `featured-ads` `features` `feature-flags` `blog` `platform-blog` `qa` `review-summary` `moderation` `newsletter` `inquiries` `report` `gbp` `hpb-menus` `ai-support` `api-keys` `backup` `chain` `white-label` `subscription-plans`
- cron（`api/cron/`・GitHub Actions から Bearer 認証で起動）：下記スケジュール参照
- Google 連携：`google-calendar` / Slack：`slack`

## cron スケジュール（SSOT＝`src/lib/cron-jobs.data.json`／`render.yaml` と `.github/workflows/cron.yml` に展開・UTC 指定／JST 併記）
| path | cron(UTC) | JST |
|------|-----------|-----|
| booking-reminder | `0 15 * * *` | 毎日 00:00 |
| daily-summary | `0 6 * * *` | 毎日 15:00 |
| customer-segment | `0 7 * * 0` | 日曜 16:00 |
| review-request | `0 18 * * *` | 毎日 03:00 |
| sync-google-ratings | `0 9 * * 0` | 日曜 18:00 |
| onboarding-followup | `0 16 * * *` | 毎日 01:00 |
| birthday-coupon | `0 14 * * *` | 毎日 23:00 |
| flag-reviews | `0 * * * *` | 毎時 |
| favorites-digest | `0 15 * * 1` | 月曜 00:00 |
| weekly-report | `10 22 * * 0` | 月曜 07:10 |
| waitlist-notify | `30 * * * *` | 毎時30分 |
| webhook-retry | `*/15 * * * *` | 15分毎 |
| hpb-menu-scrape | `20 17 * * *` | 毎日 02:20 |
| schema-drift-check | `40 17 * * *` | 毎日 02:40 |

オーナーニュースレターの自動月次配信は廃止した（神原さん確定 2026年7月2日「お知らせがある時のみ」）。旧 `/api/cron/newsletter-digest` エンドポイント・専用ワークフロー `newsletter-digest.yml`・発火監視 `monthly-batch-watcher.yml` はすべて削除済み。全店に同一の全プラットフォーム集計（「新規予約 N」等）を一斉配信していた作りを根本から廃止した。ニュースレター配信は管理画面 `/admin/newsletters` で任意の件名・本文を作成し「今すぐ配信」する手動運用のみ（`api/admin/newsletter`・`api/admin/newsletter/[id]` action=send）。台帳テーブル `newsletter_send_log` は孤児化するが、`schema-drift-check` との整合のため DB・マイグレーション・スナップショットは残置（無害）。

### 🔴 cron の現状＝【Render が実働・GitHub Actions は保険として残置】（2026年7月29日 実データで確定）

【経緯】public repo の GitHub Actions scheduled workflow は GitHub が有料/private を優先し大幅に間引く（実測で cron.yml 最大176分・health-monitor 最大283分の空白）。恒久解として `render.yaml`（Render Cron Jobs・機能ごとに独立サービス16本・SSOTは `src/lib/cron-jobs.data.json`、`src/__tests__/render-yaml-drift.test.ts` がドリフト検知）へ移行した（PR#382）。移行期間中は GitHub Actions + pg_cron + Render の三重化だったが、2026年7月29日に神原が `select cron.unschedule(jobname) from cron.job where jobname like 'carelink-%';` を実行し【pg_cron を撤去済み（15ジョブ全て解除・戻り値 true を確認）】。

【現在の実態（2026年7月29日 実データで確定）】
- 実働しているのは【Render のみ】。根拠＝(a) pg_cron 撤去後も cron_logs が正確な間隔で記録され続けている（webhook-retry 15分毎・cron-heartbeat 5分毎・flag-reviews 毎時）、(b) 同時刻に GitHub Actions cron.yml は【11時間42分間まったく発火していなかった】（最終 7月28日 15:59 UTC ／ 確認時 7月29日 03:41 UTC）。この2つから、規則正しい発火は Render 由来と確定できる。
- GitHub Actions cron.yml / health-monitor.yml は【意図的に残置】。間引かれて不定期にしか動かないが、Render が停止した際の最後の保険になるため、ローンチが安定するまでは外さない（endpoint は冪等なので重複発火は無害）。
- health-monitor.yml の Render 代替は `carelink-health-check`（`scripts/health-check.mjs`・5分毎）。

【将来 GitHub Actions を撤去する場合の注意】`.github/workflows/cron.yml` を削除すると `src/__tests__/cron-jobs-drift.test.ts`（SSOT ↔ cron.yml の三重管理ドリフト検知）が丸ごと成立しなくなる。同テストの削除または render.yaml 基準への作り替えをセットで行うこと。ドリフト検知自体は `render-yaml-drift.test.ts` が引き継げる。

【調査時の鉄則】新セッションで cron の挙動を調べる時は、まずどのスケジューラが実際に動いているかを実データで確認してから議論すること（Render Dashboard／`gh run list --workflow=cron.yml`／`select * from cron.job`／`cron_logs` の実記録）。なお `cron_logs` の `status='skipped'` は「処理対象0件＝正常」であり失敗ではない（集計時に error と混同しないこと）。

## DB スキーマ（主要テーブル・`src/lib/schema-snapshot.json` が正・全 104 テーブル）
- 予約：`bookings` `booking_menus` `booking_waitlist` `booking_calendar_events` `facility_daily_capacity` `facility_booking_suspensions`
- 施設：`facilities` `facility_profiles` `facility_members` `facility_menus` `facility_photos` `facility_certifications` `facility_symptoms` `facility_qa` `facility_reviews` `facility_cancel_policies` `facility_line_settings` `facility_notification_settings` `facility_reminder_settings` `facility_entitlements` `facility_inquiries`
- 顧客：`customers` `customer_visits` `customer_segments` `salon_customer_notes` `profiles` `favorites`
- メニュー／クーポン／パッケージ：`coupons` `coupon_menus` `menu_staff` `option_catalog` `hpb_menu_durations` `package_usage_logs`
- 決済・購読：`featured_slots` `subscription`・各 entitlement 系
- 採用・集客：`job_postings` `job_applications` `job_seekers` `facility_jobs` `recruits` `blog_posts` `blog_authors` `platform_blog_posts` `feature_articles` `area_seo_contents` `areas`
- レビュー・モデレーション：`public_reviews` `review_replies` `review_helpful` `moderation_queue` `nps_surveys`
- 通知・連携：`line_user_links` `line_notification_logs` `push_subscriptions` `google_calendar_tokens` `newsletter_subscriptions` `newsletter_campaigns` `newsletter_send_log` `email_unsubscribe_tokens` `birthday_notifications`
- 基盤：`audit_logs` `cron_logs` `rate_limit_buckets` `webhook`系 `api_keys` `feature_flags` `features` `ab_test_events` `referral_codes` `referral_uses` `contacts` `contact_replies` `intake_form_templates` `intake_form_responses` `daily_revenue_summary` `gbp_posts` `gbp_audit_cache`

`schema-drift-check` cron が本番スキーマと `schema-snapshot.json` の差分を毎日 JST 02:40 に検知（マイグレーション未適用による無音バグの発症前予防）。CI の Contract Tests（`jest.config.contract.js`）も staging のドリフトをゲートする。

## 環境変数（コード内 `process.env` 参照から抽出）
| 変数名 | 用途 |
|--------|------|
| NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase（必須） |
| SUPABASE_SERVICE_ROLE_KEY | service role（cron／管理 API のサーバ側 DB 操作・RLS バイパス・必須） |
| NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_BASE_URL / NEXT_PUBLIC_SITE_URL | 本番ベース URL（リダイレクト・OGP・sitemap 等） |
| ADMIN_COOKIE_SECRET | /admin membership キャッシュの HMAC 署名鍵（未設定でキャッシュ無効） |
| CRON_SECRET | GitHub Actions cron → `/api/cron/*` の Bearer 認証（未設定で全 cron 401／500） |
| RESEND_API_KEY / EMAIL_FROM | メール送信（未設定でメール系 cron は送信スキップ） |
| NEWSLETTER_UNSUBSCRIBE_SECRET | ニュースレター配信停止リンクの HMAC 署名鍵（手動配信 `api/admin/newsletter/[id]`／`unsubscribe` 共通・一度設定したら変更しない） |
| STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET | 決済・Stripe webhook 署名検証 |
| LINE_CHANNEL_ACCESS_TOKEN_CARELINK / LINE_CHANNEL_SECRET / LINE_CHANNEL_SECRET_CARELINK / LINE_LOGIN_CHANNEL_ID / NEXT_PUBLIC_LIFF_ID / NEXT_PUBLIC_LINE_CHANNEL_ID | LINE Messaging／LINE Login／LIFF |
| LINE_WORKS_BOT_ID / LINE_WORKS_CLIENT_ID / LINE_WORKS_CLIENT_SECRET / LINE_WORKS_PRIVATE_KEY / LINE_WORKS_SERVICE_ACCOUNT | LINE WORKS 連携 |
| SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET / SLACK_DEFAULT_CHANNEL | Slack 通知・スラッシュコマンド署名検証 |
| GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_MAPS_API_KEY | Google カレンダー連携・地図 |
| ANTHROPIC_API_KEY | AI サポート |
| RECAPTCHA_SECRET_KEY | reCAPTCHA 検証 |
| VAPID_PRIVATE_KEY / NEXT_PUBLIC_VAPID_PUBLIC_KEY | Web Push |
| NEXT_PUBLIC_GA_ID / NEXT_PUBLIC_CLARITY_ID | GA4／Clarity（空なら無効） |
| NEXT_PUBLIC_GSC_VERIFICATION_APEX | Search Console 所有権確認 |
| SUPER_ADMIN_USER_IDS | プラットフォーム super admin の user_id 群 |

## テスト・CI（`.github/workflows/ci.yml`）
- Lint & Type Check：`npm run lint` ＋ `npx tsc --noEmit`
- Unit Tests + Coverage：`npm run test:coverage:ci`。`jest.config.js` の `coverageThreshold`＝branches【100】/ lines 80 / functions 75 / statements 80。測定対象＝`src/lib/**/*.ts` ＋ `src/app/api/**/*.{ts,tsx}`（JSX を返す Route Handler の測定漏れ防止）。下回ると Coverage Gate で fail。
- E2E（Playwright）：`supabase start` → `npm run build` → `npm run test:e2e`（chromium / webkit）
- Security Audit：`npm audit --audit-level=high`
- Contract Tests（staging drift gate）：`npm run test:contract`（`jest.config.contract.js`）
- 他ワークフロー：`mutation-l4.yml`（Stryker）・`health-monitor.yml`（外形監視）・`cron-constraints.yml` / `anon-write-policy-lint.yml` / `secdef-search-path-lint.yml` / `actionlint.yml`（静的ガード）・`deploy-watch.yml` / `vercel-preview-build.yml` / `dependency-update.yml`（依存更新）。ニュースレターの自動月次配信ワークフロー（`newsletter-digest.yml`・`monthly-batch-watcher.yml`）は廃止・削除済み（配信は管理画面から手動のみ）

## 既知の罠（コード変更前に確認）

- 【🔴 Vercel Hobby の日次ビルド枠を実際に使い切ると24時間デプロイ不能になる】2026年7月29日、1日に9マージ＋7PR起票を行った結果 `Deployment rate limited — retry in 24 hours` が発生した。本番は既存デプロイで動き続けるが、この間は【緊急修正を出せない】。神原さんの判断で【Hobby を継続】（同日）。恒久対策として `vercel.json` の `ignoreCommand` に `scripts/vercel-should-build.sh` を配線し、配信物に影響しない変更（`supabase/migrations/` ・`.github/` ・`docs/` ・`e2e/` ・`scripts/` ・ルート直下の `.md` ・テストファイル）はプレビュービルドをスキップする。【production は VERCEL_ENV で判定して無条件にビルドする】（main に入った修正が本番へ出ない事故を防ぐ最重要の安全弁）。判定が緩む改変・production ガードの除去は `src/__tests__/vercel-build-skip.test.ts` が CI で止める。作業時は【1日のマージ数を意識し、複数の修正はできるだけ1本のPRにまとめる】。
- 【`src/app/**/route.ts` は HTTP メソッド（GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS）と一部 config 以外を export できない】。共有ヘルパー関数を route.ts に足すと `tsc --noEmit`・`jest`・lint は通るのに `next build`（＝Vercel デプロイ・E2E も内部で依存）だけ `"xxx" is not a valid Route export field` で Failed to compile する。Unit/Lint/Contract/Security 全 pass なのに Vercel/E2E だけ fail する場合は、まず `npx next build` をローカル実行してこれを疑う。共有関数は `src/lib/*.ts` に置き route.ts はメソッドのみ import して使う。
- Supabase の embed 名（例 `menu:facility_menus(name)`）を変更したら、対応する jest テストの mock も同じキー名に合わせること。ずれると route 側の分岐（`Array.isArray` 三項等）の片側が実行されず、テスト自体は pass するのに `coverageThreshold.global.branches=100` が崩れて CI が fail する。
- 【存在しないテーブル名・列名を参照して無音停止する事故が繰り返し発生している】（例：`menus`→正しくは`facility_menus`、`reviews`→正しくは`facility_reviews`、`facility_menus.is_active`のように元々存在しない列）。`tsc --noEmit` は Supabase クライアントに `<Database>` 型が配線されていないため列タイポを検知できない（`database.types.ts` は生成済みだが各クライアント helper が型付けされていない＝既知の恒久課題・再生成には `supabase login` が神原のターミナルで必要）。新しいテーブル／列を参照する前に必ず `src/lib/schema-snapshot.json`（全 104 テーブルの正）で実在を確認する。`schema-drift-check` cron は事後検知であり事前予防にはならない。

## 店舗ログインの仕様（繰り返し問われる）
- `auth.users` に「客／店舗」を区別するフィールドは無い。全員ただの Supabase 認証アカウント。
- 「店舗」＝`facility_members` に `role=owner`/`admin` の行があるかだけで決まる（`src/app/admin/layout.tsx`）。
- ログイン（`/auth/login`）後のデフォルトリダイレクトは `/mypage`（客向け）。店舗オーナーでも最初は客画面に見えるため、店舗管理は `/admin` に直行が必要（ブックマークは `/admin`）。
- 店舗化フロー：`/register` → `/auth/signup?redirect=/admin/onboarding&...` → `/admin/onboarding` が `/api/facility/setup` を呼び `facility_profiles`(draft)＋`facility_members`(owner) を作成。

## worktree 運用の罠（重要・PR#397 事故の再発防止）

`git worktree add` で作った作業ディレクトリで `ln -s ~/Projects/carelink/node_modules ./node_modules` している場合、`node_modules/eslint-plugin-carelink-safety` 自体も本家 carelink リポジトリへのシンボリックリンクになっている。worktree 内で `eslint-plugin-carelink-safety/index.js` を編集しても、ローカルの `npm run lint` は本家の未修正版を読み込むため、変更が一切検証されないまま「全緑」に見える（PR#397 で発生・CI で初めて317件の error が噴出）。

eslint-plugin-carelink-safety（または他の node_modules 内自作パッケージ）を worktree 内で編集する場合は、必ず `unlink node_modules/<pkg名>` → `ln -s ../../<worktree名>/<pkg名> ./node_modules/<pkg名>` で worktree 自身の実体を指すよう張り替えてから lint を実行する。

### 🔴 張り替えは物理的に本家の node_modules を書き換えている（2026年7月16日・17日 宙吊り事故の再発防止）

`git worktree add` した worktree の `node_modules` は（上記の通り）本家 `node_modules` へのディレクトリ symlink である。そのため「worktree 内で plugin リンクを張り替える」操作は、パス上は worktree 内の変更に見えても【実体は本家の `node_modules/eslint-plugin-carelink-safety` そのものを書き換えている】。「本家は無変更」という認識は誤りで、作業者がこれに気づかないまま worktree を削除すると、本家のリンクが【削除済み worktree の絶対パスを指したまま宙吊り】になり、本家の `require.resolve` が `Cannot find module` で失敗し lint が全滅する。この事故は 2026年7月16日と17日に2回実際に発生した（直近の真因は本家 checkout が古く plugin 実体が旧版化し、origin/main の新ルールと不一致で張り替えを誘発したこと）。

【恒久ガード】`scripts/ensure-eslint-plugin-link.mjs` を新設し、`package.json` の `prelint` / `pretest` / `postinstall` から自動実行する（npm の `pre<name>` 自動起動規約により `npm run lint` / `npm test` / `npm install` の直前に必ず走る）。このスクリプトは【宙吊り（実体解決不能）のときのみ】 `../eslint-plugin-carelink-safety` への正規相対 symlink に自動修復する。解決可能なリンク（worktree 実体への意図的な張り替え作業中を含む）には一切手を出さない。どの経路でも throw せず必ず exit 0（fail-safe・CI/Vercel のビルドを本スクリプトの不具合で落とさない）。

【運用ルール】
- (a) 本家の checkout を古いまま放置しない。plugin 実体が旧版のままだと origin/main の lint 設定（新ルール等）と不一致になり、張り替え作業を誘発する。定期的に `git fetch origin main` → 追従する。
- (b) worktree を削除する前に、本家の `node_modules/eslint-plugin-carelink-safety` がその worktree を指していないか `readlink /Users/kanbararyousuke/Projects/carelink/node_modules/eslint-plugin-carelink-safety` で確認する。
- (c) worktree 内で張り替えて作業したら、作業終了後に必ず `../eslint-plugin-carelink-safety`（正規の相対リンク）へ戻し、`readlink` で確認する。

マージ・クールダウン（全プロジェクト共通の `soel_last_merge_ts`）は並行 worktree 稼働時に窓の取り合いが激しい。一発待機だと他セッションのマージでタイムスタンプが更新され失敗するため、Python で `while True: ...時間到達までsleep...` のポーリング方式で即 fire させるのが確実。

`gh pr merge --delete-branch` のローカル cleanup は main worktree（`carelink-salon-board`）占有で毎回失敗するが、サーバー側のマージ自体は成功する。`git worktree remove --force` を別途実行する。

## 開発コマンド（`package.json` scripts）
```bash
npm run dev                 # 開発サーバー
npm run build               # ビルド
npm run lint                # ESLint
npm test                    # Jest
npm run test:coverage:ci    # カバレッジ（CI 同等）
npm run test:e2e            # Playwright E2E
npm run test:contract       # Contract（drift gate）
npm run test:load           # k6 負荷（search-load）
```

## テスト品質スタック 現在地

| レベル | 内容 | 状態 | 備考 |
|--------|------|------|------|
| L1 | ESLint / tsc | ✅ | エラー 0 |
| L2 | Jest ユニットテスト | ✅ | 4870 テスト全通過、223 スイート（2026年6月23日 実測） |
| L3 | Jest ブランチカバレッジ 100% | ✅ | 5733/5733 branches＝100%（2026年6月23日 実測・lines 99.41／functions 94.87／statements 98.35） |
| L4 | Stryker ミューテーション | ✅ | agent1 4ソース（i18n / seo-constants / seo-snippets / json-ld）Survived=0 を Stryker 公式実行で確定（2026-05-31）。高負荷下のOOM kill回避のため8分割並列＋順次リトライで完走。seo-snippets.ts の生存1体（`.slice(0,180)` 削除）は到達不能な防御コードに起因する等価変異だったため、180字上限を純粋関数 `truncateText`＋定数 `INTRO_MAX_LENGTH` に抽出し境界テストで kill 可能化（症状抑止ではなく予防的根本解決）。変更範囲 Stryker 再実行で Mutation score 100.00 確認。stryker.config.mjs の mutate は純粋10モジュール（上記4＋constants/safe/image-utils/jobs/validations/validations-booking/validations-auth）を break:100 で列挙済み（ただし上記4以外は未検証＝下記）。**【2026-06-10 恒久対策＋validations.ts 実測完了】**: 過去の「validations.ts 100%確定」誤報告の**根本原因を事実で確定**＝Stryker の TS チェッカーが `tsconfig.json`（`include` に `.next/types/**/*.ts` を含む）経由で **stale な Next.js 生成ルート型（main 不在ルートを参照し TS2307 大量発生）を読み込みクラッシュ**し、ミューテーション実測前に異常終了していた（`.next/types/app/admin/salon-board/page.ts` 等で再現確認済み）。**恒久的根本解決**: Stryker 専用 `tsconfig.stryker.json`（`.next` を一切 include しない・`incremental:false` で本体ビルドキャッシュ非汚染）を新設し、`stryker.config.mjs` の `tsconfigFile` をこれに切替。`.next` の状態・ブランチに依存せず**再現性100%**で TS チェック成立（tsc 実測：`.next/types` エラー 0・全エラー 0）。本体 `tsconfig.json` は無変更＝build/dev/通常 tsc に**副作用ゼロ**（症状ブロック＝手動 `.next` 再生成ではなく構造的予防）。この対策下で **`validations.ts`（124 mutant）の Stryker 本実行を完走**: **Mutation score 100.00%・Survived=0**（Killed 52／Timeout 5／NoCoverage 0／Ignored 66=静的変異 `ignoreStatic`／CompileError 1=TS が拒否＝分母外、所要 36分48秒、concurrency 1）。ログ集計表と `reports/mutation/mutation.json` の独立再計算が一致＝exit code でなく実データで確定。**【2026-06-10 全10モジュール実測完了】**: 上記恒久対策下で `stryker.config.mjs` の mutate 対象**全10モジュールを1ファイルずつ非並行で実測完走し、全て Survived=0（Mutation score 100.00%）を実データ確定**（各モジュールごとにログ集計表と mutation.json を独立再計算して照合・exit code 非依存）。内訳: validations(Killed52/TO5)・constants(Killed11)・safe(Killed13/TO5)・image-utils(Killed7/TO15)・jobs(Killed32/TO6)・validations-booking(Killed35/TO2)・validations-auth(Killed3)＝本日実測、i18n/seo-constants/seo-snippets＝2026-05-31実測（json-ld は 2026-05-30 実測・mutate 列挙外で別途確定）。constants.ts では生存3変異を性質別に恒久対処（URL正規化の境界テスト追加で実 kill／冗長デフォルトを1箇所集約し実 kill 化／dayLabels の静的データ定数 ObjectLiteral は kill 不能な等価変異として既存 disable と一貫させ除外・神原さん承認済み）。他9モジュールは無修正で 100%。**【2026-06-11 時間切れマスク恒久対策＋全10モジュール再現性確認完了】**: 神原さんの「本当に言い切れるか」の再検証要求で全モジュールを再実行したところ、**image-utils の初回「100%」が偽陽性**だったと判明。Stryker は Timeout も kill 扱いにするため、jest プロセス起動オーバーヘッド（高負荷時 ~40秒〜）が旧 `timeoutMS:30000` を超えると本来 Survived の変異まで時間切れ＝kill に誤計上され、**真の取りこぼしがマスクされる**（image-utils 初回 Timeout15 に Survived2 が埋もれていた）。**根本原因＝timeoutMS が jest 起動コストに対し低すぎ**。対象は全て純粋関数（ループ無し＝無限ループ変異が原理上発生せず、時間切れは 100% jest 起動由来の偽陽性）。**恒久対策＝timeoutMS を 30000→120000→300000 に引き上げ**（高負荷の連続実行で 120000 でもスパイクが超えたため 300000 で確定）。image-utils の実テストギャップ2件（width/quality 未指定で `=undefined` 付与）はテスト追加で実 kill（PR#94）。**timeoutMS300 下で全10モジュールを1本ずつ再実行し、全て Survived=0 かつ Timeout=0（非ループの偽時間切れ皆無）を実データ確定**: image-utils K22／jobs K38／validations-booking K37／validations-auth K3／i18n K7／seo-constants K2／constants K11／safe K18／validations K57／seo-snippets K55（各 Timeout0・Survived0）。**【2026-06-16 validations-booking 再実測（PR#158 `.refine(isValidIsoDate)` 追加後）】**: PR#158 で `validations-booking.ts` に `booking_date` 実在日検証 `.refine` を1行追加したため、Survived=0 を実データで再確認。timeoutMS300・concurrency 1・tsconfigFile=tsconfig.stryker.json 下で Stryker 本実行を完走（87 mutant）: **Mutation score 100.00・Survived=0・Timeout=0・NoCoverage=0**（Killed 37／CompileError 2=TS が型レベルで拒否＝分母外／Ignored 48=`ignoreStatic` 静的変異、所要 41分16秒）。ログ集計表と `reports/mutation/mutation.json` の独立再計算（node で status 集計）が一致＝exit code 非依存で実データ確定。2027-02-30 等の実在しない暦日を弾く回帰テストが新規 `.refine` 由来の変異を全 kill。**L4 完遂＝全対象モジュールでテストが全変異を捕捉（取りこぼし0）を、時間切れマスクのない信頼できる実データで確定。** |
| L5 | fast-check プロパティベース | ✅ | 26テスト＋safeJsonLd プロパティ7件、バグ3件修正 2026-05-29／json-ld 追加 2026-05-30 |
| L6 | npm audit / 認証テスト | ✅ | critical=0・high=0、認証バイパステスト 21件（HMAC検証・middleware） 2026-05-29 達成 |
| L7 | 構造化ログ + Slack + 外形監視 | ✅ | 2026-05-25 達成（A〜D 全基準） |
</content>
</invoke>

---

## スキーマドリフト監視（2026年8月2日 全面刷新・手管理スナップショット廃止）

**期待スキーマを人が持たない。** `supabase/migrations/*.sql` を使い捨て Postgres に
全適用した結果（shadow）を期待値とし、本番と全面突合する。

| | 旧方式（廃止） | 新方式 |
|---|---|---|
| 期待値 | `schema-constraints-snapshot.json`（**人が手管理**） | migration から毎回導出（`scripts/gen-schema-fingerprint.sh`） |
| 見る範囲 | テーブル存在・列**名**・PK/UNIQUE | 列(型/NOT NULL/DEFAULT)・**全制約**・**インデックス(部分ユニーク含む)**・**RLS ポリシー**・トリガ・関数・enum・GRANT |
| 実測項目数 | — | 2028 |

🔴 **廃止した理由（実測）**: migration `20260722000005` が `UNIQUE(facility_id,is_active)` を
**意図的に** DROP した（「非アクティブも施設あたり1件まで」という意図しない制約を、
`uq_intake_active_per_facility`（部分ユニークインデックス）へ置換）のに JSON だけ取り残され、
**毎日「制約欠落1」を誤報し続けていた**。しかも置換先の部分ユニークインデックスは
`pg_constraint` に行を作らないため、旧方式では**構造的に検知不能**だった。
さらに RLS ポリシー（実測 131 本＝施設間データ分離の実体）が **1 本も監視されていなかった**。

### 構成
- `supabase/shadow/00_bootstrap.sql` — Supabase 互換の最小 bootstrap（**本番には絶対に適用しない**）
- `scripts/schema-fingerprint.sql` — introspection 本体（唯一の真実源）
- `supabase/migrations/*_schema_fingerprint_rpc.sql` — 上記の**機械転記**。本番側 RPC
- `scripts/gen-schema-fingerprint.sh [--check]` — 期待値の生成／陳腐化検査
- `src/lib/schema-fingerprint.expected.json` — **生成物。手で編集しない**
- `.github/workflows/schema-fingerprint.yml` — CI で `--check`（再生成忘れを止める）

### 触るときの鉄則
1. 🔴 **フィンガープリントは必ず RPC 経由で取る。** `scripts/schema-fingerprint.sql` を
   psql で直実行すると `search_path` に public があるため `pg_get_constraintdef` /
   `format_type` が名前を修飾せず、`SET search_path=''` の本番 RPC と食い違う。
   **全 FK と全 geography 列が差分になる**（実測で踏んだ）。
2. 🔴 **shadow と本番の PostgreSQL メジャーバージョンを揃える。** `pg_get_*` の整形は
   バージョン間で変わり得るため、揃えないと「差分ではない差分」が出て誤報になる。
   これは注意書きではなく**機械強制**されている — フィンガープリントに
   `meta|server_version_major|<n>` 行が含まれ、食い違うと `diffFingerprint` が
   `versionMismatch` を返して**差分を 1 件も主張せず**、cron が 1 件だけ警報する
   （整形差の数百件を「ドリフト」として報告しない）。
   **【実測 2026年8月3日】この危険は仮説ではない。** 同一 migration 群を PG16 と PG17 の
   shadow に全適用して突合したところ、**スキーマは 1 箇所も違わないのに 290 行が差分**に
   なった（PostgreSQL 17 で権限 `MAINTAIN` が追加され、`GRANT ALL` の展開が
   `DELETE,INSERT,REFERENCES,…` → `DELETE,INSERT,MAINTAIN,REFERENCES,…` に変わるため）。
   ガードが無ければ「290 件のドリフト」という存在しない事故を毎日報告していた。
   ⚠️ **マイナー(パッチ)は比較対象に入れない。** 最初 `server_version_num` を丸ごと
   入れていたが、Supabase は本番のマイナーを随時上げ、CI の postgis イメージのタグも
   パッチを固定していないため、**スキーマが 1 文字も変わらなくても必ずいつか鳴る**
   誤報の確定装置だった（2026年8月3日に修正）。整形が変わり得るのはメジャー間で、
   万一マイナーで変わっても整形が変わった行そのものが差分に出る。
   ✅ **実測確定（2026年8月3日）: 本番は `server_version_num=170006`（PostgreSQL 17）**。
   接続先ガードを通過した後の同一実行で得た値なので CareLink 本番のものと確定している。
   CI の `postgis/postgis:17-3.5` はこの実測と一致する。将来メジャーが上がったら
   上記 `versionMismatch` の通知に本番の実測値が入るので、それを見て CI を直す。
   期待値を手元で再生成するときも CI と同じメジャーを使うこと
   （用意できない場合は CI を失敗させ、成果物 `schema-fingerprint-expected`
   または CI ログの `BEGIN schema-fingerprint.expected.json` 以降をコミットする）。
3. 🔴 **拡張が所有するオブジェクトは除外する**（postgis のバージョン差が誤報になる）。
4. 🔴 **0 件同士の一致を緑と読み替えない。** `diffFingerprint` は 500 項目未満を
   `vacuous=true` として扱い、cron は「走査が空振り」として警報する。
5. 🔴 **接続先プロジェクトを必ず確認してから実行する。** 本番 project ref は
   `xzafxiupbflvgbarrihe`（URL: `supabase.com/dashboard/project/xzafxiupbflvgbarrihe`）。
   2026年8月2日、指示に project を書かなかったため **soel(`lsrbeugmqqqklywmvjjs`) で
   実行され**、soel のスキーマを CareLink の期待値と突合して
   「RLS が 90 本欠落」という**存在しない事故を報告しかけた**。
   数字が大きくズレたら、まず「同じ DB を見ているか」を疑うこと。
6. 🔴 **bootstrap は Supabase の既定権限も再現する。** Supabase は
   `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated,
   service_role` を持つため、public の全テーブルに 3 ロール分の GRANT が自動で付く。
   再現しないと **全テーブルの grant 行が差分**になる（実測: 再現前 16 行 → 再現後 290 行）。
   `ALTER DEFAULT PRIVILEGES` は後続に作られるものにだけ効くので、**migration より前**に置く。
7. 除外（`scripts/schema-drift-allow.txt`）は **理由必須**。理由が空の行は無効。
   除外してよいのは「Supabase が管理していて migration に現れないもの」だけ。
8. migration を足したら `scripts/gen-schema-fingerprint.sh` を実行して結果をコミットする
   （忘れると CI が赤くなる＝手で同期する余地を残さない）。
9. 🔴 **差分エンジンは 2 本ある。安全側の挙動を片方だけ直さない。**
   `src/lib/schema-drift.ts` の `diffFingerprint`（cron が使う本番経路）と
   `scripts/schema-diff.mjs` の `comparabilityProblem`（人が手で叩く調査用 CLI）。
   障害調査で CLI を叩いた人が cron と違う結論（＝存在しないドリフト）に至る状態そのものが
   欠陥なので、しきい値・判定順序（空振り → 別 DB → メジャーバージョン）の一致を
   `src/lib/__tests__/schema-diff-allow.test.ts` が機械で強制する。
   同テストは CLI を **実際にプロセス起動して**配線も確かめる（関数が在るだけで
   `main()` から呼ばれていない状態を緑にしないため）。負の対照つき。
10. ⚠️ **`scripts/schema-fingerprint.sql` はコメント 1 文字の変更でも本番 RPC の再適用が要る。**
   フィンガープリントは自分自身の関数を `body_md5`（`prosrc` の md5）で見ているため。
   これは不便ではなく正しい: 本番の RPC 本文がリポジトリとズレていれば
   **両側で違う SQL を実行している**＝突合が無意味なので、必ず赤くならなければいけない。
   手順は「SQL を編集 → 期待値を再生成 → 本番へ migration を再適用」の 3 点セット。

### 現在の未解決差分（2026年8月4日時点・実測）

初回突合で検出した差分の処理状況。**警報が鳴ったらまずここを見る**。

| 検出内容 | 件数 | 状態 |
|---|---|---|
| 既知の本番専用テーブル7本に由来 | 143 | ✅ `known-prod-only.json` で除外済み |
| 本番に無かったトリガ2本 | 2 | ✅ 本番へ適用して復旧（`20260803000001`） |
| migration 側の旧オーバーロード2本 | 2 | ✅ 撤去（`20260804000001`・本番は no-op） |
| **本番にだけ在ると思われていた関数11本** | **11** | ✅ **解決済み（2026-08-11・本番に不在と確定）** |

✅ **解決済みの 11 本**（2026年8月11日、CONFIRMED CareLink 本番 DB（ref: `xzafxiupbflvgbarrihe`）
   への直接確認で `functions_present: []` ＝**11 本とも本番に実在しない**ことを確定した）:

```
booking_status_occupies, create_admin_booking_atomic, create_blog_author_atomic,
get_facility_customers, get_user_points_balance, hpb_menu_durations_touch_updated_at,
reorder_coupons, reorder_facility_menus, reorder_facility_photos,
set_review_pickup_atomic, update_admin_booking_atomic
```

**結論**: 2026年8月3日時点で「本番にだけ在る」としていた前提が誤りだった。実際には
**既に本番から削除済み**（いつ・誰が消したかは不明）で、残っていたのは repo 側の
古い記載（本節および `src/lib/schema-fingerprint.expected.json` 等）だけだった。
migration にも定義が無い点は当時の記載どおり（＝そもそも migration-less な残存だった）。
DROP・台帳登録・migration 取り込みのいずれのアクションも不要（対象が本番に無いため）。
以後 cron の `driftExtra` にこの 11 本が現れることは無い想定。もし今後これらの名前で
`driftExtra` が再び鳴ったら、それは「本番へ何者かが再作成した」新規事象であり、
本節の解決済み扱いを再度見直すこと。
