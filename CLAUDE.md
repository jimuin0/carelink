# CareLink

## プロジェクト概要
医療・福祉・美容 施設向けの【予約管理・集客・採用】を統合したマルチテナント SaaS（旧 LP から予約管理プラットフォームへ移行済み）。施設オーナーが予約枠・メニュー・スタッフ・クーポンを管理し、来院者は施設検索・予約・問診・レビューを行う。決済は Stripe、メッセージングは LINE / LIFF、メールは Resend を使う。

- フロント／API＝Next.js 15（App Router・Route Handler）/ デプロイ＝Vercel（本番 `https://carelink-jp.com`・`www.` はアペックスへ 301）
- DB／認証＝Supabase（Postgres・Auth・Storage・RLS・RPC）
- 定期実行＝【Render Cron Jobs が唯一の本番スケジューラ】（`render.yaml`＝`services:` に cron 16 本＋`envVarGroups:` に `carelink-cron-env` 1 本）。GitHub Actions cron（`.github/workflows/cron.yml`）はファイルとしては残っているが【GitHub 上で無効化（`disabled_manually`）されており発火しない】（下記「cron の現状」参照）。`/api/cron/*` を Bearer 認証で叩く。オーナーニュースレターの自動月次配信は廃止（神原さん確定 2026年7月2日「お知らせがある時のみ」）＝digest エンドポイント・専用ワークフロー・発火監視をすべて削除。配信は管理画面 `/admin/newsletters` からの手動送信のみ
- 本番 Supabase project ref＝`xzafxiupbflvgbarrihe`。middleware の CSP `connect-src` は `NEXT_PUBLIC_SUPABASE_URL` から導出し、**env 欠落時のみ**この ref にハードコードでフォールバックする（`getSupabaseConnectSrc()`）

## 技術スタック
- Next.js 15.5（App Router）/ React 18 / TypeScript 5
- Tailwind CSS 3.4
- react-hook-form 7 + `@hookform/resolvers` 5 + zod 4（バリデーション）
- Supabase＝`@supabase/supabase-js` 2 + `@supabase/ssr`（SSR Cookie 認証）
- 決済＝Stripe（`stripe` / `@stripe/stripe-js`）
- メッセージング＝`@line/liff`（LIFF）・LINE Messaging API・LINE WORKS
- メール＝Resend / Web Push＝`web-push`（VAPID）
- 地図＝Leaflet + `@react-map/japan` / グラフ＝Recharts / QR＝`qrcode`
- AI＝`@anthropic-ai/sdk`（問い合わせサポート等）
- 解析＝`@vercel/analytics` / `@vercel/speed-insights` / GA4（`@next/third-parties` の `GoogleAnalytics`・`src/app/layout.tsx`）/ Microsoft Clarity
- テスト＝Jest 30（jsdom）・Playwright（E2E）＋`@axe-core/playwright`（a11y・`e2e/a11y-audit.spec.ts`）・Stryker 9（ミューテーション）・fast-check（プロパティ）・k6（負荷）
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
supabase/migrations/         # DB マイグレーション（本数は `ls supabase/migrations/*.sql | wc -l` で取る）
.github/workflows/           # CI（ci.yml 他・全13ファイル）。有効／無効は GitHub 側の状態＝「テスト・CI」節を見る
render.yaml                  # Render Cron Jobs（本番スケジューラの実体）
scripts/                     # 運用スクリプト・診断 SQL（diagnose-*.sql）・スキーマ fingerprint 生成
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
5. 例外は必ず catch して 500 に変換し、`safeCaptureException` ＋ `alertCaughtError`（Slack 通知・応答は遅らせない）。catch して 500 を返すと `instrumentation.ts` の onRequestError に伝播せず Slack 通知が漏れるため、catch 経路でも明示通知する。通知は `runAfterResponse` 経由で応答後に実行される（下記「応答後に走らせる副作用の SSOT」・**全 500 応答の Slack 通知がこの経路**なので取りこぼすと障害に気づけない）。

### middleware（`src/middleware.ts`）
- 全応答に per-request nonce ベースの CSP を付与（`'strict-dynamic'` + nonce で `'unsafe-inline'` を script から排除）。`x-nonce` / `x-pathname` をサーバーコンポーネントへ伝搬。
- 保護パス＝`PROTECTED_PATHS = ['/mypage', '/admin']`。未認証は `/auth/login?redirect=...` へ。
- `/admin` は `facility_members` の `owner`/`admin` ロールのみ許可。`/admin/onboarding` は除外（施設未作成オーナーの作成導線を確保）。
- admin メンバーシップは Cookie キャッシュ（キー `_cm_mbr_{userId16}`・値を `ADMIN_COOKIE_SECRET` で HMAC-SHA256 署名・TTL 300 秒）。未設定時はキャッシュ無効（DB 都度確認）。

### cron 認証（`src/lib/cron-auth.ts`）
`checkCronAuth`：`Authorization: Bearer ${CRON_SECRET}` を `timingSafeEqual`（定数時間・長さ不一致は別途 false）で検証。`CRON_SECRET` 未設定は 500。

### 応答後に走らせる副作用の SSOT＝`src/lib/after-response.ts`（2026年8月12日 新設・PR#587/#588）

`runAfterResponse(task)` が唯一の登録口。**新しく「応答後に走らせたい副作用」を足すときは
`void doSomething()` と書かず必ずこれを通す。**

🔴 **なぜ必要か（本番の実害）**：サーバーレス（Vercel）は【レスポンスを返した時点でインスタンスを
凍結・終了してよい】ため、浮いた Promise（`void ...`）の完了は保証されない。実際に本番の
`audit_logs` は全期間 5 行しかなく、うち 4 行は DB トリガ由来で、アプリの `void writeAuditLog(...)`
83 箇所に由来する行は 1 行だけだった。

- 実装は Next.js の `after()`（Next 15.1+）。登録するだけなので**応答は遅くならない**。
- `after()` が使えない文脈（スクリプト・単体テスト）では task の完了を返すのでテストが決定的に検証できる。
- `next/server` は**遅延 require** している（先頭で import すると jsdom 環境の単体テストが import だけで落ちるため）。
- `task` は自分で例外処理すること。この関数は失敗を報告しない（報告経路自体がこの仕組みに依存するため）。
- 現在この経路に載っているのは `writeAuditLog`（`audit-logger.ts`）と `postAlert` 系（`alert.ts`）。
- `sendNotify` の呼びっぱなしは `src/__tests__/post-response-notify-guard.test.ts` が CI で止める
  （`/api/contact`・`/api/salons` 2箇所・`/api/inquiry` の受信通知が実際に取りこぼされていた）。

### 監査ログ（`src/lib/audit-logger.ts`）
重要操作は `void writeAuditLog({...})` で `audit_logs` に記録する。`void` を付ける＝呼び出し元は待たない。
内部で `runAfterResponse` を通すので、**投げっぱなしではなく応答後の実行が保証される**（上記参照）。
export は `writeAuditLog` / `getRequestContext`（Request から ip・ua を取り出す）と型 `AuditAction` / `AuditLogEntry` の 4 つだけ。
変更前後は `oldValues` / `newValues` に呼び出し側が渡す（差分抽出ヘルパーは存在しない）。`AuditAction` は
`create` `update` `delete` `login` `logout` `publish` `suspend` `verify` `approve` `reject` `cancel` `confirm` `export` `booking_adjust_request` の 14 種。

### プラットフォーム管理者判定＝`src/lib/platform-admin.ts`

`requirePlatformAdmin()` が唯一の判定。`profiles.is_platform_admin`（DB カラム）が true のユーザーだけを返し、
未認証・profile 不在・false は全て `null`（フェイルセーフ）。

🔴 **環境変数 `SUPER_ADMIN_USER_IDS` 方式は廃止済み**（監査 A6b）。`admin/backup` が DB カラム方式・
`admin/features` 系だけが環境変数方式という二重化があり、環境変数側は再デプロイなしに変更できず
複数人の管理もできないため DB カラム方式へ一本化した。コード上に `process.env.SUPER_ADMIN_USER_IDS` の
参照は 1 箇所も残っていない。

### メール送信元の SSOT＝`src/lib/email-from.ts`（2026年7月31日 新設・PR#556/#558）

送信元(`from`)を組み立ててよいのはこのモジュールだけ。**呼び出し側が `process.env.EMAIL_FROM` を
直読みすることは `src/lib/__tests__/email-from-callers.test.ts` が CI で禁止している**
（送信元アドレスのハードコードも同テストが禁止）。

- `fromEnv()` … 全ての送信箇所が使う from。本番で【検証済みドメイン以外】なら
  `CareLink <noreply@carelink-jp.com>` へ強制フォールバックする。
- `newsletterFromEnv()` … ニュースレター用。同じ検証を通す。
- `resolvedFromEnv()` … 診断情報つき（`fellBack` / `rawDomain` / `domainOk`）。`email.ts` の警報判定用。
- `productionResolvedFrom()` … 常に本番基準で解決。`/api/health` の監視用。
- `RESEND_VERIFIED_DOMAINS` … Resend で verified なドメイン。ここに無い from は配信されない。

【なぜ集約したか】未検証ドメイン(`resend.dev` 等)を検知しても【警告するだけで倒していなかった】ため、
設定ミスがそのまま送信全滅に直結していた。さらに cron 5本（review-request / waitlist-notify /
customer-segment / birthday-coupon / webhook-retry）とニュースレターが `process.env.EMAIL_FROM` を
各自で組み立てて `resend.emails.send` を直接呼び、ガードを完全に迂回していた。
メール経路は送信対象が 0 件のうちは一度も実行されず、誤設定に気づけないまま初回配信で発症する。

### LINE の出し分け＝`src/lib/line-availability.ts`（PR#552/#557）

- `isLineEnabled()` … `NEXT_PUBLIC_LIFF_ID` の有無。マイページ・管理画面の LINE 項目がこれに従属。
- `isLineLoginEnabled()` … `isLineEnabled()` かつ `NEXT_PUBLIC_LINE_CHANNEL_ID` あり。
  `/auth/login` `/auth/signup` の「LINEでログイン／登録」がこれに従属。

LINE ログインは LIFF とは別チャネルで動くため、どちらか片方だけを見る判定は誤る。
【製品判断（LIFF 設定済み＝LINEを出す）】と【技術的前提（ログインチャネル設定済み）】の
両方が揃ったときだけ出す。手動フラグは使わない（戻し忘れ事故を作らないため env に従属させる）。
`src/lib/__tests__/line-availability.test.ts` が、ガードの外に `/api/auth/line` 導線が
1本も無いことまで検証する。

### 連携の出し分け＝`src/lib/integration-availability.ts`（PR#553）

`isAiEnabled()` / `isPaymentsEnabled()` / `isGoogleCalendarEnabled()`。
未設定の連携を「使えるように見せない」ための単一判定。

### `/api/health` の Resend プローブ（PR#556/#558）

API キーの疎通だけでなく、**Resend の `/domains` を実際に引いて送信元ドメインが verified か**を照合し、
さらに**既定値へ倒れた事実（`fellBack`）自体を NG として出す**。

- 未検証ドメイン／形式不正の `EMAIL_FROM` → `deps.resend.ok=false` → degraded → health-monitor が Issue+Slack
- `EMAIL_FROM` 未設定は誤設定ではない（既定値が妥当）ので緑のまま
- 非本番は resend.dev サンドボックスが正常系のため照合しない

【意図】メールを1通も送らずに設定の正誤を判定できるようにするため。倒す実装だけでは
「配信は救われるが設定は誤ったまま緑に隠れる」ので、倒した事実を監視に出している。

### 画像URLの2段ガード＝`storage-url-guard.ts` / `stock-image-guard.ts`

画像URLを受け取る入口は、必ずこのどちらかを通す。**どちらも通っていない入口が1つでもあると
`src/__tests__/stock-image-guard-wiring.test.ts` が CI で落ちる**（判定関数が「在るだけで
配線されていない」状態を緑にしないため）。

- `isAllowedStorageUrl(url, bucket)`（`storage-url-guard.ts`）… 自 Supabase Storage の公開
  プレフィックス限定。外部ホストを一切保存させない。`salons` / `review` の写真がこれ。
- `isStockImageUrl(url)` / `isNewStockImage(next, previous)`（`stock-image-guard.ts`）…
  任意の https URL を受け付けざるを得ない入口＝`feature_articles.image_url`（`admin/features`）と
  `facility_menus.photo_url`（`admin/menus`）で、**ストック写真サービス（Unsplash 等
  `STOCK_IMAGE_DOMAINS`）の新規保存だけ**を拒否する。

【なぜストック画像を止めるか】初期シード（`20260321000004` / `20260331000001` /
`scripts/seed-facilities.mjs`）が実店舗の写真の代わりに Unsplash URL を投入したため、本番に
「実在しない施設写真」が残っている。表示のために `next.config.mjs` の `remotePatterns` へ
`images.unsplash.com` を許可し続けるしかなく、任意のホットリンク画像を出せる外部ホストが
1つ常設された状態になっている。既存分の差し替えは本番データの作業だが、増やさないのはコードの仕事。

🔴 **`isNewStockImage` が「既存値と同一なら素通し」なのは順序依存を消すため。** 管理画面は
フォーム全体を PATCH するので、画像を変えない更新でも image_url/photo_url は必ず載ってくる。
無条件に拒否すると、ストック画像が残っている記事・メニューを一切編集できなくなり、
「本番データの掃除 → ガード投入」の順序でしか入れられなくなる。素通し条件があるので**掃除より
先に入れても安全**（掃除後は素通しする値が存在しないので挙動は変わらない）。

⚠️ **`next.config.mjs` から `images.unsplash.com` を外すのは本番データの差し替えが済んでから。**
先に外すと既存画像が next/image で 400 になり `/search`・`/ranking` の表示が壊れる
（2026年7月5日に実機で発生済み）。この順序は上記テストが 1 本の検査で固定しており、
差し替え完了時にその検査ごと削除する。

### Supabase クライアントの使い分け
- `createServerSupabaseClient`（`supabase-server.ts`）＝anon。公開データの読み取り専用。書き込み・ユーザー固有データに使わない。
- `createServiceRoleClient`（`supabase-server.ts`）＝service role。RLS バイパス。API ルート・cron などサーバー信頼文脈のみ。
- `createServerSupabaseAuthClient`（`supabase-server-auth.ts`）＝SSR Cookie 認証。ログインユーザー文脈の読み書き。
- `createBrowserSupabaseClient`（`supabase-browser.ts`）＝ブラウザ用。

## API ルート一覧（`src/app/api/`）
- 公開・来院者系：`facilities` `facility` `salons` `availability` `slots` `booking` `waitlist` `options` `symptoms` `stations` `recommendations` `ab-test` `referral` `review` `nps` `report` `favorites` `profile` `account` `chat` `intake` `contact` `inquiry` `unsubscribe` `health` `og` `v1` `push` `[...notfound]`（未定義 API パスの catch-all）
- 認証・LINE：`auth` `liff` `line`
- 決済：`payment` `stripe`
- 管理（`api/admin/`・施設オーナー／プラットフォーム）：`bookings` `booking-status` `booking-checkout` `booking-adjust-request` `customers` `staff` `menus` `catalog` `coupons` `packages` `user-packages` `subscription-plans` `user-subscriptions` `payments-settings` `accounting-export` `settings` `facility-verify` `registrations` `jobs` `job-applications` `featured-ads` `features` `feature-flags` `blog` `platform-blog` `qa` `review-summary` `moderation` `newsletter` `inquiries` `report` `gbp` `hpb-menus` `ai-support` `api-keys` `backup` `chain` `white-label`（実ディレクトリ 38 本と一致）
- cron（`api/cron/`・Render Cron Jobs から Bearer 認証で起動。実ディレクトリ 15 本）：下記スケジュール参照
- 運用・監視：`alert-check`（`ALERT_CHECK_TOKEN` で保護）・`admin`（管理画面用API群は下記）
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
| cron-heartbeat | `7,37 * * * *` | 毎時07分・37分（監視系の生存確認・`/api/health` の cron 鮮度判定に使う） |
| schema-drift-check | `40 17 * * *` | 毎日 02:40 |

オーナーニュースレターの自動月次配信は廃止した（神原さん確定 2026年7月2日「お知らせがある時のみ」）。旧 `/api/cron/newsletter-digest` エンドポイント・専用ワークフロー `newsletter-digest.yml`・発火監視 `monthly-batch-watcher.yml` はすべて削除済み。全店に同一の全プラットフォーム集計（「新規予約 N」等）を一斉配信していた作りを根本から廃止した。ニュースレター配信は管理画面 `/admin/newsletters` で任意の件名・本文を作成し「今すぐ配信」する手動運用のみ（`api/admin/newsletter`・`api/admin/newsletter/[id]` action=send）。台帳テーブル `newsletter_send_log` は孤児化するが、`schema-drift-check` との整合のため DB・マイグレーション・スナップショットは残置（無害）。

### 🔴 cron の現状＝【Render のみが実働。GitHub Actions cron は無効化済みで保険にならない】（2026年8月12日 GitHub API で確定）

【経緯】public repo の GitHub Actions scheduled workflow は GitHub が有料/private を優先し大幅に間引く（実測で cron.yml 最大176分・health-monitor 最大283分の空白）。恒久解として `render.yaml`（Render Cron Jobs・機能ごとに独立サービス16本・SSOTは `src/lib/cron-jobs.data.json`、`src/__tests__/render-yaml-drift.test.ts` がドリフト検知）へ移行した（PR#382）。移行期間中は GitHub Actions + pg_cron + Render の三重化だったが、2026年7月29日に神原が `select cron.unschedule(jobname) from cron.job where jobname like 'carelink-%';` を実行し【pg_cron を撤去済み（15ジョブ全て解除・戻り値 true を確認）】。

【現在の実態（2026年8月12日 GitHub API `GET /repos/jimuin0/carelink/actions/workflows` で確定）】
- 実働しているのは【Render のみ】。根拠＝(a) pg_cron 撤去後も cron_logs が SSOT どおりの間隔で記録され続けている（webhook-retry 15分毎・cron-heartbeat 30分毎＝毎時07分/37分・flag-reviews 毎時）、(b) 下記のとおり GitHub Actions 側は無効化されていて発火し得ない。
- 🔴 **`cron.yml` / `health-monitor.yml` / `deploy-watch.yml` は GitHub 上で `state: disabled_manually`＝発火しない**（無効化日時は workflow の `updated_at`：health-monitor と deploy-watch が 2026年7月25日、cron.yml が 2026年7月29日）。**ファイルが `.github/workflows/` に在ることを「保険が効いている」と読まないこと。** 3本とも Render 側に等価物があるため運用の穴は無い（cron 15本＋`carelink-health-check`）。再び保険として使いたい場合は、ファイルを足すのではなく GitHub の Actions 画面で **Enable workflow** する必要がある。
- health-monitor.yml の Render 代替は `carelink-health-check`（`scripts/health-check.mjs`・5分毎）。

【将来 GitHub Actions を撤去する場合の注意】`.github/workflows/cron.yml` を削除すると `src/__tests__/cron-jobs-drift.test.ts`（SSOT ↔ cron.yml の三重管理ドリフト検知）が丸ごと成立しなくなる。同テストの削除または render.yaml 基準への作り替えをセットで行うこと。ドリフト検知自体は `render-yaml-drift.test.ts` が引き継げる。

【調査時の鉄則】新セッションで cron の挙動を調べる時は、まずどのスケジューラが実際に動いているかを実データで確認してから議論すること。**最初に見るのは workflow の有効／無効**（`gh workflow list --all` または `GET /repos/jimuin0/carelink/actions/workflows` の `state`）で、次に Render Dashboard／`cron_logs` の実記録／`select * from cron.job`。`gh run list --workflow=cron.yml` は「無効で発火していない」と「間引かれて発火していない」を区別できないので、これ単独で結論を出さない。なお `cron_logs` の `status='skipped'` は「処理対象0件＝正常」であり失敗ではない（集計時に error と混同しないこと）。

## DB スキーマ（主要テーブル・`src/lib/schema-snapshot.json` が正）

テーブル数は書かない（DROP/追加のたびに腐るため）。実数はこれで取る：
`node -e "console.log(Object.keys(require('./src/lib/schema-snapshot.json')).length)"`
本番の実数は PostgREST の OpenAPI（`GET {SUPABASE_URL}/rest/v1/`）の `definitions` を数える。両者が食い違えばドリフト。

- 予約：`bookings` `booking_waitlist` `booking_calendar_events` `facility_daily_capacity` `facility_booking_suspensions`
- 施設：`facility_profiles` `facility_members` `facility_menus` `facility_photos` `facility_certifications` `facility_symptoms` `facility_qa` `facility_reviews` `facility_cancel_policies` `facility_line_settings` `facility_notification_settings` `facility_reminder_settings` `facility_entitlements` `facility_inquiries`
- 顧客：`customers` `customer_visits` `customer_segments` `salon_customer_notes` `profiles` `favorites`
- メニュー／クーポン／パッケージ：`coupons` `coupon_menus` `menu_staff` `option_catalog` `hpb_menu_durations` `package_usage_logs`
- 決済・購読：`featured_slots` `subscription_plans` `user_subscriptions` `subscription_usage_logs` `facility_entitlements`
- 採用・集客：`job_postings` `job_applications` `job_seekers` `facility_jobs` `blog_posts` `blog_authors` `platform_blog_posts` `feature_articles` `area_seo_contents` `areas`
- レビュー・モデレーション：`public_reviews` `review_replies` `review_helpful` `moderation_queue` `nps_surveys`
- 通知・連携：`line_user_links` `line_notification_logs` `push_subscriptions` `google_calendar_tokens` `newsletter_subscriptions` `newsletter_campaigns` `newsletter_send_log` `email_unsubscribe_tokens` `birthday_notifications`
- 基盤：`audit_logs` `cron_logs` `rate_limit_buckets` `stripe_webhook_logs` `webhook_retry_queue` `api_keys` `feature_flags` `features` `ab_test_events` `referral_codes` `referral_uses` `contacts` `contact_replies` `intake_form_templates` `intake_form_responses` `daily_revenue_summary` `gbp_posts` `gbp_audit_cache`

`schema-drift-check` cron が本番スキーマと `schema-snapshot.json` の差分を毎日 JST 02:40 に検知（マイグレーション未適用による無音バグの発症前予防）。CI の Contract Tests（`jest.config.contract.js`）も staging のドリフトをゲートする。

## 環境変数（コード内 `process.env` 参照から抽出）
| 変数名 | 用途 |
|--------|------|
| NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase（必須） |
| SUPABASE_SERVICE_ROLE_KEY | service role（cron／管理 API のサーバ側 DB 操作・RLS バイパス・必須） |
| NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_BASE_URL / NEXT_PUBLIC_SITE_URL | 本番ベース URL（リダイレクト・OGP・sitemap 等） |
| ADMIN_COOKIE_SECRET | /admin membership キャッシュの HMAC 署名鍵（未設定でキャッシュ無効） |
| CRON_SECRET | Render Cron Jobs → `/api/cron/*` の Bearer 認証（未設定で全 cron 500・不一致で 401・`src/lib/cron-auth.ts`） |
| CARELINK_BASE_URL | Render cron dispatcher が叩く本番ベース URL（`src/lib/render-cron.mjs` の `resolveCronEndpoint`・未設定は throw。`render.yaml` の envVarGroup `carelink-cron-env` で全 cron サービスへ供給） |
| RESEND_API_KEY | メール送信（未設定でメール系 cron は送信スキップ） |
| EMAIL_FROM | 送信元。本番では検証済みドメイン以外だと既定値へ強制フォールバックする（`src/lib/email-from.ts`） |
| NEWSLETTER_EMAIL_FROM | ニュースレター専用の送信元。未設定なら `CareLink <newsletter@carelink-jp.com>`。EMAIL_FROM と同じ検証を通る |
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
| NEXT_PUBLIC_RECAPTCHA_SITE_KEY | reCAPTCHA のサイトキー（未設定なら検証をスキップ＝bot 対策は rate limit のみ） |
| ALERT_CHECK_TOKEN | `/api/alert-check` の Bearer 認証（未設定で 500） |
| ADMIN_HEARTBEAT_URL / ADMIN_HEARTBEAT_TOKEN | 管理画面ハートビートの送信先とトークン（未設定で送信しない・`src/lib/admin-heartbeat.ts`） |

## テスト・CI（`.github/workflows/ci.yml`）
- Lint & Type Check：`npm run lint` ＋ `npx tsc --noEmit`
- Unit Tests + Coverage：`npm run test:coverage:ci`。`jest.config.js` の `coverageThreshold`＝branches【100】/ lines 80 / functions 75 / statements 80。測定対象＝`src/lib/**/*.ts` ＋ `src/app/api/**/*.{ts,tsx}`（JSX を返す Route Handler の測定漏れ防止）＋ `src/lib/**/*.mjs`（Render cron dispatcher の純粋ロジック `render-cron.mjs` もゲート対象）、`src/**/*.d.ts` は除外。下回ると Coverage Gate で fail。
- E2E（Playwright）：`supabase start` → `npm run build` → `npm run test:e2e`（chromium / webkit）
- Security Audit：`npm audit --audit-level=high`
- Contract Tests（staging drift gate）：`npm run test:contract`（`jest.config.contract.js`）
- 他ワークフロー（`.github/workflows/` は全 13 ファイル＋Dependabot の動的ワークフロー 1 本）。**有効／無効は GitHub 側の状態なのでファイルの有無で判断しないこと**：
  - **有効**：`schema-fingerprint.yml`（push/PR で migration からスキーマ期待値を再生成し陳腐化を検査）・`migration-apply-reminder.yml`（PR に新規 migration があれば本番適用を促す）・`mutation-l4.yml`（Stryker・週次 日曜 JST 03:00）・`dependency-update.yml`（依存更新・週次 月曜 JST 09:00）・`vercel-preview-build.yml`（PR で `vercel build` ドライ実行・repo variable `ENABLE_VERCEL_PR_BUILD == 'true'` のときだけ動く）・`cron-constraints.yml` / `anon-write-policy-lint.yml` / `secdef-search-path-lint.yml` / `actionlint.yml`（いずれも `paths:` 絞り込み付きの静的ガード）
  - **無効（`disabled_manually`）**：`cron.yml` / `health-monitor.yml` / `deploy-watch.yml`（上記「cron の現状」参照）
- ニュースレターの自動月次配信ワークフロー（`newsletter-digest.yml`・`monthly-batch-watcher.yml`）は廃止・削除済み（配信は管理画面から手動のみ）

## 既知の罠（コード変更前に確認）

- 【🔴 Vercel Hobby の日次ビルド枠を実際に使い切ると24時間デプロイ不能になる】2026年7月29日、1日に9マージ＋7PR起票を行った結果 `Deployment rate limited — retry in 24 hours` が発生した。本番は既存デプロイで動き続けるが、この間は【緊急修正を出せない】。神原さんの判断で【Hobby を継続】（同日）。恒久対策として `vercel.json` の `ignoreCommand` に `scripts/vercel-should-build.sh` を配線し、配信物に影響しない変更（`supabase/migrations/` ・`.github/` ・`docs/` ・`e2e/` ・`scripts/` ・ルート直下の `.md` ・テストファイル）はプレビュービルドをスキップする。【production は VERCEL_ENV で判定して無条件にビルドする】（main に入った修正が本番へ出ない事故を防ぐ最重要の安全弁）。判定が緩む改変・production ガードの除去は `src/__tests__/vercel-build-skip.test.ts` が CI で止める。作業時は【1日のマージ数を意識し、複数の修正はできるだけ1本のPRにまとめる】。
- 【`src/app/**/route.ts` は HTTP メソッド（GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS）と一部 config 以外を export できない】。共有ヘルパー関数を route.ts に足すと `tsc --noEmit`・`jest`・lint は通るのに `next build`（＝Vercel デプロイ・E2E も内部で依存）だけ `"xxx" is not a valid Route export field` で Failed to compile する。Unit/Lint/Contract/Security 全 pass なのに Vercel/E2E だけ fail する場合は、まず `npx next build` をローカル実行してこれを疑う。共有関数は `src/lib/*.ts` に置き route.ts はメソッドのみ import して使う。
- Supabase の embed 名（例 `menu:facility_menus(name)`）を変更したら、対応する jest テストの mock も同じキー名に合わせること。ずれると route 側の分岐（`Array.isArray` 三項等）の片側が実行されず、テスト自体は pass するのに `coverageThreshold.global.branches=100` が崩れて CI が fail する。
- 【🔴 PATCH で `.update({ ...parsed.data, X: parsed.data.X || null })` と書かない＝送られていない列を無言で消す】zod の `.optional()` は未指定キーを出力オブジェクトに含めないため、spread の【後ろ】に置いた明示キーが常に勝ち、その列を含まないリクエストでも必ず `null` が書き込まれる。本番で実害が出ていた実例2件：`/admin/menus` の並び替え(↑↓)は `{ sort_order }` だけを送るので**並び替えるだけでメニュー写真が消え**、`/admin/features` の公開トグルは `{ is_active }` だけを送るので**トグルするだけで特集記事の画像が消えていた**（どちらも「保存した覚えが無いのに画像だけ消える」ため発覚が遅れる）。正しい形は `blog/[id]` などが採っている「未定義なら足さない」：`const updatePayload = { ...parsed.data }; if (parsed.data.X !== undefined) updatePayload.X = parsed.data.X || null;`。`src/__tests__/partial-update-clobber-guard.test.ts` がこの書き方の再発を CI で止める（INSERT は対象外＝新規作成では既定値に倒すのが正しい）。
- 【🔴 RLS がかかった表の「0 件」をデータ消失と読まない】anon キーや非メンバーのログイン文脈で数えた件数は、RLS が行を隠していれば必ず 0 になる。**同じ 0 でも表ごとに意味が違う**のが厄介で、実例が `treatment_*` 3表：`treatment_catalogs` は `treatment_catalogs_public_read`（`FOR SELECT USING (true)`）があるので anon の 0 は本当に 0 だが、`treatment_plans` / `treatment_records` は `..._facility_all`（`FOR ALL USING (EXISTS(facility_members … role IN ('owner','admin')))`）の 1 本だけで **SELECT 用の公開ポリシーが無い**ため、行があっても anon からは必ず 0 に見える。件数を根拠に議論する前に、**Supabase Dashboard の SQL Editor（postgres 権限＝RLS 素通し）で数え直す**こと。手順は `scripts/diagnose-treatment-tables.sql` にある。なお `facility_profiles` を 1 行削除すると `ON DELETE CASCADE` で 56 表が連鎖削除される（`treatment_*` 3表を含む）ので、件数が本当に減っていた場合はまず施設が消えていないかを見る。
- 【🔴 `audit_logs.record_id` は TEXT・各表の `id` は UUID。素で `=` すると本番で 42883 になる】`record_id` はどの表の id でも入る汎用列なので TEXT。`a.record_id = m.id` と書くと `ERROR: 42883 operator does not exist: text = uuid` で落ちる（2026年8月11日に本番の SQL Editor で実際に踏んだ）。`database.types.ts` はどちらも `string` として出すため型検査では防げない。必ず `a.record_id = m.id::text` と揃える。`src/__tests__/diagnostic-sql-columns.test.ts` が診断 SQL のキャスト漏れを CI で止める。
- 【🔴 調査 SQL の検証スタブは必ず実型で作る。全列 text のスタブは型不一致を原理的に見逃す】上の 42883 を流出させた直接原因がこれ。検証用の使い捨て DB を「全列 text」で作っていたため、`text = uuid` が発生しようがなく「実行検証済み」と誤って報告した。型の正は `src/lib/schema-fingerprint.expected.json`（migration 群から機械生成）だけなので、スタブは `node scripts/gen-stub-schema.mjs <table>…` で生成する（postgis 型だけは拡張なしでも通るよう text に落とし、その旨を注記する）。`src/__tests__/stub-schema-types.test.ts` が、事故そのものの列ペア（`record_id`=text / `id`=uuid）で生成器を固定している。
- 【本番を調べる SQL は `scripts/diagnose-*.sql` に置き、列の実在を CI で検査する】この環境から本番 DB へは接続できないため、調査は「Dashboard に貼る SELECT 専用ランブック」で渡す。`-- @check <table>.<column>` 行を書いておくと `src/__tests__/diagnostic-sql-columns.test.ts` が `schema-snapshot.json` と突合し、存在しない列・宣言漏れ（本文に足したのに `@check` を書き忘れた枝）・`STOCK_IMAGE_DOMAINS` との列挙ズレを CI で落とす。上記の「存在しない列で無音停止」を SQL 側でも塞ぐための仕組み。
- 【🔴 `facility_card_view` には「テーブルには在るが view には無い列」がある。参照すると PostgREST 400 → error 握り潰しで無音全滅する】かつて `nearest_station` が view 非射影のままキーワード検索の `.or()` から参照され、**例外もログも出ないままキーワード検索が常に0件**になっていた（migration `20260722000002` で射影して解消）。`database.types.ts` は各 Supabase クライアントに配線されていないので `tsc` では防げない。view に列を足す前に `src/lib/schema-snapshot.json` の `facility_card_view` を見ること。`src/__tests__/card-view-columns.test.ts` が select 列・`ilike` 対象列・並び替え列を実在列と突合して CI で止める。
- 【存在しないテーブル名・列名を参照して無音停止する事故が繰り返し発生している】（例：`menus`→正しくは`facility_menus`、`reviews`→正しくは`facility_reviews`、`facility_menus.is_active`のように元々存在しない列）。`tsc --noEmit` は Supabase クライアントに `<Database>` 型が配線されていないため列タイポを検知できない（`database.types.ts` は生成済みだが各クライアント helper が型付けされていない＝既知の恒久課題・再生成には `supabase login` が神原のターミナルで必要）。新しいテーブル／列を参照する前に必ず `src/lib/schema-snapshot.json`（実在テーブル／列の正）で実在を確認する。`schema-drift-check` cron は事後検知であり事前予防にはならない。

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
npm run test:contract       # Contract（drift gate・jest.config.contract.js）
npm run test:e2e:security   # E2E のうち security.spec.ts のみ
npm run test:e2e:perf       # E2E のうち performance.spec.ts のみ
npm run test:e2e:a11y       # E2E のうち accessibility.spec.ts のみ
npm run test:load           # k6 負荷（search-load）
npm run test:load:soak      # k6 soak
npm run test:load:booking   # k6 同時予約
npm run test:all            # test:ci → test:e2e
```

`prelint` / `pretest` / `postinstall` に `node scripts/ensure-eslint-plugin-link.mjs` が配線されており、
`npm run lint` / `npm test` / `npm install` の直前に必ず走る（下記「worktree 運用の罠」の恒久ガード）。

## テスト品質スタック 現在地

| レベル | 内容 | 状態 | 備考 |
|--------|------|------|------|
| L1 | ESLint / tsc | ✅ | エラー 0 |
| L2 | Jest ユニットテスト | ✅ | 件数は書かない（増減で腐るため）。実数は `npm run test:coverage:ci` の出力で取る |
| L3 | Jest ブランチカバレッジ 100% | ✅ | branches 100% を `jest.config.js` の `coverageThreshold` が CI で強制。実数は `npm run test:coverage:ci` の出力で取る |
| L4 | Stryker ミューテーション | ✅ | agent1 4ソース（i18n / seo-constants / seo-snippets / json-ld）Survived=0 を Stryker 公式実行で確定（2026-05-31）。高負荷下のOOM kill回避のため8分割並列＋順次リトライで完走。seo-snippets.ts の生存1体（`.slice(0,180)` 削除）は到達不能な防御コードに起因する等価変異だったため、180字上限を純粋関数 `truncateText`＋定数 `INTRO_MAX_LENGTH` に抽出し境界テストで kill 可能化（症状抑止ではなく予防的根本解決）。変更範囲 Stryker 再実行で Mutation score 100.00 確認。stryker.config.mjs の mutate は純粋10モジュール（上記4＋constants/safe/image-utils/jobs/validations/validations-booking/validations-auth）を break:100 で列挙済み（ただし上記4以外は未検証＝下記）。**【2026-06-10 恒久対策＋validations.ts 実測完了】**: 過去の「validations.ts 100%確定」誤報告の**根本原因を事実で確定**＝Stryker の TS チェッカーが `tsconfig.json`（`include` に `.next/types/**/*.ts` を含む）経由で **stale な Next.js 生成ルート型（main 不在ルートを参照し TS2307 大量発生）を読み込みクラッシュ**し、ミューテーション実測前に異常終了していた（`.next/types/app/admin/salon-board/page.ts` 等で再現確認済み）。**恒久的根本解決**: Stryker 専用 `tsconfig.stryker.json`（`.next` を一切 include しない・`incremental:false` で本体ビルドキャッシュ非汚染）を新設し、`stryker.config.mjs` の `tsconfigFile` をこれに切替。`.next` の状態・ブランチに依存せず**再現性100%**で TS チェック成立（tsc 実測：`.next/types` エラー 0・全エラー 0）。本体 `tsconfig.json` は無変更＝build/dev/通常 tsc に**副作用ゼロ**（症状ブロック＝手動 `.next` 再生成ではなく構造的予防）。この対策下で **`validations.ts`（124 mutant）の Stryker 本実行を完走**: **Mutation score 100.00%・Survived=0**（Killed 52／Timeout 5／NoCoverage 0／Ignored 66=静的変異 `ignoreStatic`／CompileError 1=TS が拒否＝分母外、所要 36分48秒、concurrency 1）。ログ集計表と `reports/mutation/mutation.json` の独立再計算が一致＝exit code でなく実データで確定。**【2026-06-10 全10モジュール実測完了】**: 上記恒久対策下で `stryker.config.mjs` の mutate 対象**全10モジュールを1ファイルずつ非並行で実測完走し、全て Survived=0（Mutation score 100.00%）を実データ確定**（各モジュールごとにログ集計表と mutation.json を独立再計算して照合・exit code 非依存）。内訳: validations(Killed52/TO5)・constants(Killed11)・safe(Killed13/TO5)・image-utils(Killed7/TO15)・jobs(Killed32/TO6)・validations-booking(Killed35/TO2)・validations-auth(Killed3)＝本日実測、i18n/seo-constants/seo-snippets＝2026-05-31実測（json-ld は 2026-05-30 実測・mutate 列挙外で別途確定）。constants.ts では生存3変異を性質別に恒久対処（URL正規化の境界テスト追加で実 kill／冗長デフォルトを1箇所集約し実 kill 化／dayLabels の静的データ定数 ObjectLiteral は kill 不能な等価変異として既存 disable と一貫させ除外・神原さん承認済み）。他9モジュールは無修正で 100%。**【2026-06-11 時間切れマスク恒久対策＋全10モジュール再現性確認完了】**: 神原さんの「本当に言い切れるか」の再検証要求で全モジュールを再実行したところ、**image-utils の初回「100%」が偽陽性**だったと判明。Stryker は Timeout も kill 扱いにするため、jest プロセス起動オーバーヘッド（高負荷時 ~40秒〜）が旧 `timeoutMS:30000` を超えると本来 Survived の変異まで時間切れ＝kill に誤計上され、**真の取りこぼしがマスクされる**（image-utils 初回 Timeout15 に Survived2 が埋もれていた）。**根本原因＝timeoutMS が jest 起動コストに対し低すぎ**。対象は全て純粋関数（ループ無し＝無限ループ変異が原理上発生せず、時間切れは 100% jest 起動由来の偽陽性）。**恒久対策＝timeoutMS を 30000→120000→300000 に引き上げ**（高負荷の連続実行で 120000 でもスパイクが超えたため 300000 で確定）。image-utils の実テストギャップ2件（width/quality 未指定で `=undefined` 付与）はテスト追加で実 kill（PR#94）。**timeoutMS300 下で全10モジュールを1本ずつ再実行し、全て Survived=0 かつ Timeout=0（非ループの偽時間切れ皆無）を実データ確定**: image-utils K22／jobs K38／validations-booking K37／validations-auth K3／i18n K7／seo-constants K2／constants K11／safe K18／validations K57／seo-snippets K55（各 Timeout0・Survived0）。**【2026-06-16 validations-booking 再実測（PR#158 `.refine(isValidIsoDate)` 追加後）】**: PR#158 で `validations-booking.ts` に `booking_date` 実在日検証 `.refine` を1行追加したため、Survived=0 を実データで再確認。timeoutMS300・concurrency 1・tsconfigFile=tsconfig.stryker.json 下で Stryker 本実行を完走（87 mutant）: **Mutation score 100.00・Survived=0・Timeout=0・NoCoverage=0**（Killed 37／CompileError 2=TS が型レベルで拒否＝分母外／Ignored 48=`ignoreStatic` 静的変異、所要 41分16秒）。ログ集計表と `reports/mutation/mutation.json` の独立再計算（node で status 集計）が一致＝exit code 非依存で実データ確定。2027-02-30 等の実在しない暦日を弾く回帰テストが新規 `.refine` 由来の変異を全 kill。**L4 完遂＝全対象モジュールでテストが全変異を捕捉（取りこぼし0）を、時間切れマスクのない信頼できる実データで確定。** |
| L5 | fast-check プロパティベース | ✅ | 26テスト＋safeJsonLd プロパティ7件、バグ3件修正 2026-05-29／json-ld 追加 2026-05-30 |
| L6 | npm audit / 認証テスト | ✅ | critical=0・high=0、認証バイパステスト 21件（HMAC検証・middleware） 2026-05-29 達成 |
| L7 | 構造化ログ + Slack + 外形監視 | ✅ | 2026-05-25 達成（A〜D 全基準）。外形監視の実体は Render の `carelink-health-check`（`scripts/health-check.mjs`・5分毎）。GitHub の `health-monitor.yml` は無効化済みなので数に入れない |

## スキーマドリフト監視（2026年8月2日 全面刷新・手管理スナップショット廃止）

**期待スキーマを人が持たない。** `supabase/migrations/*.sql` を使い捨て Postgres に
全適用した結果（shadow）を期待値とし、本番と全面突合する。

| | 旧方式（廃止） | 新方式 |
|---|---|---|
| 期待値 | `schema-constraints-snapshot.json`（**人が手管理**） | migration から毎回導出（`scripts/gen-schema-fingerprint.sh`） |
| 見る範囲 | テーブル存在・列**名**・PK/UNIQUE | 列(型/NOT NULL/DEFAULT)・**全制約**・**インデックス(部分ユニーク含む)**・**RLS ポリシー**・トリガ・関数・enum・GRANT |
| 実測項目数 | — | migration を足すたび増えるので数字は書かない。`node -e "console.log(require('./src/lib/schema-fingerprint.expected.json').length)"` で取る |

🔴 **廃止した理由（実測）**: migration `20260722000005` が `UNIQUE(facility_id,is_active)` を
**意図的に** DROP した（「非アクティブも施設あたり1件まで」という意図しない制約を、
`uq_intake_active_per_facility`（部分ユニークインデックス）へ置換）のに JSON だけ取り残され、
**毎日「制約欠落1」を誤報し続けていた**。しかも置換先の部分ユニークインデックスは
`pg_constraint` に行を作らないため、旧方式では**構造的に検知不能**だった。
さらに RLS ポリシー（`policy|` で始まる行＝施設間データ分離の実体）が **1 本も監視されていなかった**。
種別ごとの内訳は `node -e "const d=require('./src/lib/schema-fingerprint.expected.json');const k={};for(const l of d)k[String(l).split('|')[0]]=(k[String(l).split('|')[0]]||0)+1;console.log(k)"` で取る。

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
   ✅ **この形は cron/CLI の自動経路では塞いである**（`src/lib/schema-drift.ts`）。
   期待側と実測側の重なりが `SAME_DATABASE_MIN_OVERLAP = 0.5`（50%）を割ったら、
   差分を数える**前に** `differentDatabase` として返す。CLI 側は `scripts/schema-diff.mjs` の
   `comparabilityProblem` が同じ判定を持つ（項目 9 参照）。
   ⚠️ ただし**手で SQL Editor を叩くときは依然として無防備**（同じ誤接続の事故が複数回起きている）。
   調査クエリには必ず `(to_regclass('public.facility_profiles') IS NOT NULL) AS is_carelink` を
   SELECT に埋め込み、結果に接続先を残すこと。migration 側は
   `20260803000001_restore_missing_triggers.sql` 冒頭の `DO $guard$` が
   `public.facility_profiles` の不在で例外を投げる形を持つ（誤った DB へ適用しても何も作らない）。
   同じ守り方（適用前に `to_regclass` で接続先を確認して落とす）は新しい migration にも踏襲すること。
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
   本番側の実体は RPC `public.get_schema_fingerprint()`（cron がこれを呼ぶ）。
   **本番にこの RPC が無ければ突合は一度も成立しない**ので、初回導入時は本番への適用が必須。
11. 🔴 **タイムスタンプ接頭辞の無い migration に関数定義を置かない。**
   シェルの glob も `supabase start` も**辞書順**で適用するため、接頭辞の無いファイル
   （`combined_phase2_to_6.sql`）は必ず `2026*` の**後**に走る。そこに
   `CREATE OR REPLACE FUNCTION` があると、後続 migration の改良を毎回無条件で巻き戻す。
   実際に `get_available_slots` と `handle_new_user` がこの形で複数本の改良を
   fresh-apply のたびに失っていた。**実害は「新環境が古くなる」だけではない** —
   CI は `supabase start` で fresh-apply した DB に E2E を回すため、
   古い定義（営業時間ガードやバッファの無い版）を検証し続けていた
   （＝乖離を捕まえるためのゲートが本番と別物を検証していた）。
   ⚠️ ファイル名を時系列に直す案は**不可**。実際に改名して試したところ
   `ERROR: relation "facility_reviews" does not exist` で落ちた＝最後に走る必要がある。
   真の予防は「最後に走るファイルへ関数定義を**置けなくする**」で、
   `src/lib/__tests__/migration-last-file-guard.test.ts` が機械強制する（空振り下限あり）。
   1 本ずつ気づいて消す運用は発火源の列挙で、次に足される定義を守らない。

### 🔴 差分を調べるときの手順（この順で。逆をやると必ず間違える）

1. **接続先の識別子を結果に埋め込む。** 上記「触るときの鉄則」項目5の `is_carelink` を
   SELECT に入れる。入れ忘れて別プロジェクトの結果を CareLink のものとして読む事故が
   複数回起きている
2. **件数差から内訳を語らない。** 「同じオブジェクトの定義違い」は extra と missing に
   1 件ずつ出るため、**単純な件数差では相殺されて見えなくなる**。件数の一致・不一致だけで
   内訳を推測しないこと
3. 種別（`kind|target|detail` の `kind`）ごとの md5 → (種別, テーブル) ごとの md5 → 該当行、
   と**絞り込んでから**中身を見る（`scripts/schema-fingerprint.sql` の出力形式）
4. 関数の `body_md5` 相違は**コメントや改行だけのことがある**。
   `md5(regexp_replace(regexp_replace(prosrc,'--[^\n]*','','g'),'\s+',' ','g'))`
   で比較すれば装飾差とロジック差を機械的に分けられる

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
