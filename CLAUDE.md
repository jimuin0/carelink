# CareLink

## プロジェクト概要
医療・福祉・美容 施設向けの【予約管理・集客・採用】を統合したマルチテナント SaaS（旧 LP から予約管理プラットフォームへ移行済み）。施設オーナーが予約枠・メニュー・スタッフ・クーポンを管理し、来院者は施設検索・予約・問診・レビューを行う。決済は Stripe、メッセージングは LINE / LIFF、メールは Resend を使う。

- フロント／API＝Next.js 15（App Router・Route Handler）/ デプロイ＝Vercel（本番 `https://carelink-jp.com`・`www.` はアペックスへ 301）
- DB／認証＝Supabase（Postgres・Auth・Storage・RLS・RPC）
- 定期実行＝GitHub Actions cron（`.github/workflows/cron.yml`・14 ジョブ）が `/api/cron/*` を Bearer 認証で叩く
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
- 公開・来院者系：`facilities` `facility` `salons` `availability` `slots` `booking` `waitlist` `options` `symptoms` `stations` `recommendations` `ab-test` `referral` `review` `nps` `report` `favorites` `profile` `account` `chat` `intake` `contact` `inquiry` `health` `og` `v1`
- 認証・LINE：`auth` `liff` `line` `push` `notify`
- 決済：`payment` `stripe`
- 管理（`api/admin/`・施設オーナー／プラットフォーム）：`bookings` `booking-status` `booking-checkout` `booking-adjust-request` `customers` `staff` `menus` `catalog` `coupons` `packages` `user-packages` `subscription-plans` `user-subscriptions` `payments-settings` `accounting-export` `settings` `facility-verify` `registrations` `jobs` `job-applications` `featured-ads` `features` `feature-flags` `blog` `platform-blog` `qa` `review-summary` `moderation` `newsletter` `inquiries` `report` `gbp` `hpb-menus` `ai-support` `api-keys` `backup` `chain` `white-label` `subscription-plans`
- cron（`api/cron/`・GitHub Actions から Bearer 認証で起動）：下記スケジュール参照
- Google 連携：`google-calendar` / Slack：`slack`

## cron スケジュール（`.github/workflows/cron.yml`・UTC 指定／JST 併記）
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
| waitlist-notify | `30 * * * *` | 毎時30分 |
| webhook-retry | `*/15 * * * *` | 15分毎 |
| hpb-menu-scrape | `20 17 * * *` | 毎日 02:20 |
| schema-drift-check | `40 17 * * *` | 毎日 02:40 |

## DB スキーマ（主要テーブル・`src/lib/schema-snapshot.json` が正・全 80+ テーブル）
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
| NEWSLETTER_UNSUBSCRIBE_SECRET | 月次ニュースレター配信停止リンクの HMAC 署名鍵（newsletter-digest／unsubscribe 共通・一度設定したら変更しない） |
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
- 他ワークフロー：`mutation-l4.yml`（Stryker）・`health-monitor.yml`（外形監視）・`cron-constraints.yml` / `anon-write-policy-lint.yml` / `secdef-search-path-lint.yml` / `actionlint.yml`（静的ガード）・`deploy-watch.yml` / `vercel-preview-build.yml`

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
| L2 | Jest ユニットテスト | ✅ | 4047 テスト全通過、180 スイート |
| L3 | Jest ブランチカバレッジ 100% | ✅ | 5426/5426 branches（2026-05-26 達成） |
| L4 | Stryker ミューテーション | ✅ | agent1 4ソース（i18n / seo-constants / seo-snippets / json-ld）Survived=0 を Stryker 公式実行で確定（2026-05-31）。高負荷下のOOM kill回避のため8分割並列＋順次リトライで完走。seo-snippets.ts の生存1体（`.slice(0,180)` 削除）は到達不能な防御コードに起因する等価変異だったため、180字上限を純粋関数 `truncateText`＋定数 `INTRO_MAX_LENGTH` に抽出し境界テストで kill 可能化（症状抑止ではなく予防的根本解決）。変更範囲 Stryker 再実行で Mutation score 100.00 確認。stryker.config.mjs の mutate は純粋10モジュール（上記4＋constants/safe/image-utils/jobs/validations/validations-booking/validations-auth）を break:100 で列挙済み（ただし上記4以外は未検証＝下記）。**【2026-06-10 恒久対策＋validations.ts 実測完了】**: 過去の「validations.ts 100%確定」誤報告の**根本原因を事実で確定**＝Stryker の TS チェッカーが `tsconfig.json`（`include` に `.next/types/**/*.ts` を含む）経由で **stale な Next.js 生成ルート型（main 不在ルートを参照し TS2307 大量発生）を読み込みクラッシュ**し、ミューテーション実測前に異常終了していた（`.next/types/app/admin/salon-board/page.ts` 等で再現確認済み）。**恒久的根本解決**: Stryker 専用 `tsconfig.stryker.json`（`.next` を一切 include しない・`incremental:false` で本体ビルドキャッシュ非汚染）を新設し、`stryker.config.mjs` の `tsconfigFile` をこれに切替。`.next` の状態・ブランチに依存せず**再現性100%**で TS チェック成立（tsc 実測：`.next/types` エラー 0・全エラー 0）。本体 `tsconfig.json` は無変更＝build/dev/通常 tsc に**副作用ゼロ**（症状ブロック＝手動 `.next` 再生成ではなく構造的予防）。この対策下で **`validations.ts`（124 mutant）の Stryker 本実行を完走**: **Mutation score 100.00%・Survived=0**（Killed 52／Timeout 5／NoCoverage 0／Ignored 66=静的変異 `ignoreStatic`／CompileError 1=TS が拒否＝分母外、所要 36分48秒、concurrency 1）。ログ集計表と `reports/mutation/mutation.json` の独立再計算が一致＝exit code でなく実データで確定。**【2026-06-10 全10モジュール実測完了】**: 上記恒久対策下で `stryker.config.mjs` の mutate 対象**全10モジュールを1ファイルずつ非並行で実測完走し、全て Survived=0（Mutation score 100.00%）を実データ確定**（各モジュールごとにログ集計表と mutation.json を独立再計算して照合・exit code 非依存）。内訳: validations(Killed52/TO5)・constants(Killed11)・safe(Killed13/TO5)・image-utils(Killed7/TO15)・jobs(Killed32/TO6)・validations-booking(Killed35/TO2)・validations-auth(Killed3)＝本日実測、i18n/seo-constants/seo-snippets＝2026-05-31実測（json-ld は 2026-05-30 実測・mutate 列挙外で別途確定）。constants.ts では生存3変異を性質別に恒久対処（URL正規化の境界テスト追加で実 kill／冗長デフォルトを1箇所集約し実 kill 化／dayLabels の静的データ定数 ObjectLiteral は kill 不能な等価変異として既存 disable と一貫させ除外・神原さん承認済み）。他9モジュールは無修正で 100%。**【2026-06-11 時間切れマスク恒久対策＋全10モジュール再現性確認完了】**: 神原さんの「本当に言い切れるか」の再検証要求で全モジュールを再実行したところ、**image-utils の初回「100%」が偽陽性**だったと判明。Stryker は Timeout も kill 扱いにするため、jest プロセス起動オーバーヘッド（高負荷時 ~40秒〜）が旧 `timeoutMS:30000` を超えると本来 Survived の変異まで時間切れ＝kill に誤計上され、**真の取りこぼしがマスクされる**（image-utils 初回 Timeout15 に Survived2 が埋もれていた）。**根本原因＝timeoutMS が jest 起動コストに対し低すぎ**。対象は全て純粋関数（ループ無し＝無限ループ変異が原理上発生せず、時間切れは 100% jest 起動由来の偽陽性）。**恒久対策＝timeoutMS を 30000→120000→300000 に引き上げ**（高負荷の連続実行で 120000 でもスパイクが超えたため 300000 で確定）。image-utils の実テストギャップ2件（width/quality 未指定で `=undefined` 付与）はテスト追加で実 kill（PR#94）。**timeoutMS300 下で全10モジュールを1本ずつ再実行し、全て Survived=0 かつ Timeout=0（非ループの偽時間切れ皆無）を実データ確定**: image-utils K22／jobs K38／validations-booking K37／validations-auth K3／i18n K7／seo-constants K2／constants K11／safe K18／validations K57／seo-snippets K55（各 Timeout0・Survived0）。**【2026-06-16 validations-booking 再実測（PR#158 `.refine(isValidIsoDate)` 追加後）】**: PR#158 で `validations-booking.ts` に `booking_date` 実在日検証 `.refine` を1行追加したため、Survived=0 を実データで再確認。timeoutMS300・concurrency 1・tsconfigFile=tsconfig.stryker.json 下で Stryker 本実行を完走（87 mutant）: **Mutation score 100.00・Survived=0・Timeout=0・NoCoverage=0**（Killed 37／CompileError 2=TS が型レベルで拒否＝分母外／Ignored 48=`ignoreStatic` 静的変異、所要 41分16秒）。ログ集計表と `reports/mutation/mutation.json` の独立再計算（node で status 集計）が一致＝exit code 非依存で実データ確定。2027-02-30 等の実在しない暦日を弾く回帰テストが新規 `.refine` 由来の変異を全 kill。**L4 完遂＝全対象モジュールでテストが全変異を捕捉（取りこぼし0）を、時間切れマスクのない信頼できる実データで確定。** |
| L5 | fast-check プロパティベース | ✅ | 26テスト＋safeJsonLd プロパティ7件、バグ3件修正 2026-05-29／json-ld 追加 2026-05-30 |
| L6 | npm audit / 認証テスト | ✅ | critical=0・high=0、認証バイパステスト 21件（HMAC検証・middleware） 2026-05-29 達成 |
| L7 | 構造化ログ + Slack + 外形監視 | ✅ | 2026-05-25 達成（A〜D 全基準） |
</content>
</invoke>
