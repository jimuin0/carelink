# CareLink 本番を Cloudflare Workers（有料）へ移す計画（2026-11-04 作成）

## 現状（2026-11-04 実測）

- 本番 main は `7312ac7`。**main には Cloudflare 向けのビルド・配信の仕組みが入っていない**（`wrangler.jsonc`・`vite.config.mts`・`tools/cloudflare/`・`build:vinext` はいずれも検証用 PR #866・#872・#873 にだけある）。
- DNS（Cloudflare・TTL 300・どちらも DNS のみ＝灰色の雲）
  - `carelink-jp.com` A → `216.198.79.1`（Vercel。`docs/MANUAL.md` の `76.76.21.21` から既に変わっている）
  - `www.carelink-jp.com` CNAME → `cname.vercel-dns.com`
  - 応答ヘッダーは `server: Vercel`
- wrangler はこの Mac で本人のアカウント（`d7cef176…`）にログイン済み。ただし権限は workers の書き込みまでで、**ゾーン（DNS・ルート）の書き込み権限が無い**。
- 外部サービスの宛先はすべて独自ドメイン（`https://carelink-jp.com/...`）。DNS を切り替えれば同じ URL のまま Cloudflare に届く。
  - Render cron：`CARELINK_BASE_URL`（render.yaml では Render 側の環境変数グループから供給）
  - Stripe webhook：`/api/payment/webhook`・`/api/stripe/webhook`（テストモード）
  - LINE：`/api/auth/callback/line`・`/api/line/webhook`
  - Supabase Auth：Site URL / Redirect URL（ドメイン基準）
  - Resend：送信のみ（送信元ドメインの DNS レコード＝SPF/DKIM 等は触らない）

## Cloudflare アカウント（2026-11-05 本人決定）

Worker と Workers Paid は、**carelink-jp.com を購入したアカウント**（Tokuhal.jimuin0@gmail.com's Account・`d7cef176…`）に置く。
ドメインは同じアカウントの Cloudflare Registrar で登録され DNS もそこにあるので、**ドメインの移動は行わない**。
（2026-11-04 に一度「carelink 専用アカウントを作ってドメインを移す」案になったが、移動元の DNS・メール転送がすべて消える危険があり、
本人の判断で取りやめた。移動前の DNS 11 本・Email Routing・SSL の控えは作業者の手元に残してある。）

## 移行前に直す必要があるもの（コード）

1. ✅（ブランチで対応済み）**利用者 IP の取り方（安全上必須）**：`src/lib/client-ip.ts` は `x-real-ip` を最優先で信じる。Vercel はこれを上書きするが、
   **Cloudflare は上書きしない**ため、利用者が好きな値を送ればレート制限・監査ログの IP を偽れる。
   `CARELINK_EDGE=cloudflare` のときだけ、Cloudflare が必ず上書きする `cf-connecting-ip` を最優先にし `x-real-ip` は見ない。
   Vercel では `cf-connecting-ip` を誰も上書きしないので、Cloudflare 以外では従来どおり（逆に信じるとなりすましを許す）。
2. ✅（`wrangler.jsonc` の vars）**環境の判定**：`VERCEL_ENV` を見ている箇所（有料掲載の fail-closed・公開閲覧専用の判定・通知の env 表示）がある。
   Worker の変数に `VERCEL_ENV=production` を入れる（コードの書き換えより影響が小さい）。
3. **Vercel 専用の部品**：Speed Insights は PR #873 で空の部品に差し替え済み。Vercel 固有の `after()` は Worker 用の実装に差し替え済み（PR #873）。
4. ✅（`tools/cloudflare/worker-entry.ts`）**www → アペックスの 301**：今は Vercel がやっている。Worker の入口で同じ 301 を返す。
5. ✅ **workers.dev とプレビュー URL を止める**：`workers_dev: false`・`preview_urls: false`（前回試験の指摘）。

## 使う部品（2026-11-04 本人承認「使ってよい」）

PR #873（`f678359`）の Cloudflare 部分だけを、新しいブランチへ移す案。
- 移す：`wrangler.jsonc`（本番用に名前と変数を直す）・`vite.config.mts`・`tools/cloudflare/` のうち配信に要るもの
  （after-response / worker-entry / og-image-assets / prepare-og-assets / build-local / safe-image-optimizer / normalize-webp-assets / sharp-stub / speed-insights-stub / worker-modules.d.ts とそのテスト）・
  `package.json` の依存追加・`next.config.mjs` の 1 行・`src/lib/og-image*.ts` の差分。
- 移さない：通知の送信状態の migration・店舗審査の区分・E2E/CI の作り替えなど、移行と関係のない変更（DB 変更を伴うため）。

## 手元での確認結果（2026-11-04・本番には何も反映していない）

本人の指示「慎重に行いたいのでマージ・本番反映をせず、ローカルで進めて見せて」に従い、ブランチ
`codex/cloudflare-production-migration-20261104` を手元にだけ作って確かめた（push・PR・配信はしていない）。

- 依存は PR #873 で検証済みの版に固定（`vinext 1.4.0`・`@cloudflare/vite-plugin 1.66.0`・`wrangler 4.156.0`）。
  新しい版（vite-plugin 1.67）は wrangler 4.156.1 以上を要求してビルドが止まり、vinext 1.4.3 では画像変換失敗時の元画像返却テストが落ちた。
- npm 10（Node 22 同梱）は `overrides` の `"$postcss"` 参照で `Unable to resolve reference` になる。CI と同じ npm 11 で lock を作った。
- `npm run build:vinext` 成功（`dist/client` 26 MB・`dist/server` 56 MB・圧縮前）。lint・型検査・Worker 側 node テスト 14 件・追加した単体テスト成功。
- `vite preview`（ローカル workerd）で本番 Supabase を公開用の鍵だけで読み、公開閲覧専用（`VERCEL_ENV=preview`）にして表示：
  `/`・`/search`（本番と同じ 4 件）・`/search?area=tokyo`・`/tokyo`・`/osaka`・店舗ページ・`/register`・`/api/health` が 200。
  `/admin`・`/auth/login` は 403、`POST /api/contact` は 403（公開閲覧専用で停止）。
- 注意：`VERCEL_ENV=production` のまま service role 無しで動かすと、`/search`（絞り込みなし）は service role で読む作りのため
  エラー画面になる。本番では鍵を登録するので問題にならないが、**鍵の登録漏れはこの形で表に出る**。
- 注意：Worker のビルドは作業フォルダの `.dev.vars` を `dist/server/` へ写す。`wrangler deploy` は `.dev.vars` を送らないが、
  本番用のビルドは `.dev.vars` の無い状態で行うこと。

## 手順

## 試験配信の結果（2026-11-05・本番の A / CNAME は未変更）

- 本人が Workers Paid に切り替え（`workers_paid` 有効を確認）、アカウント表示名を `carelink` に変更。
- Worker `carelink` をルートなしで配信し、確認用ホスト `cf-check.carelink-jp.com`（Workers Custom Domain）だけにつないだ。
- 秘密値 19 個を Vercel の Production から登録（すべて `secret_text`）。手元の一時ファイルは削除。
  **Vercel で Sensitive 指定の 6 個は読み出せなかった**：`ADMIN_COOKIE_SECRET` は Worker 用に新しく生成（キャッシュの署名鍵なので Vercel と別でよい）。
  `SLACK_BOT_TOKEN`・`SLACK_SIGNING_SECRET`・`SLACK_DEFAULT_CHANNEL`・`OPERATOR_NOTIFY_EMAIL`・`EMAIL_FROM` は**本人が Cloudflare の画面で入れる（切り替え前に必須）**。
- 見つけて直したもの：
  1. Node 版の Supabase 読み取りは undici の Agent を通す。Worker 用ビルドでは通常の fetch に差し替えた（`tools/cloudflare/public-read-transport.ts`）。
  2. Vercel の `NEXT_PUBLIC_SUPABASE_ANON_KEY` は**値の末尾に改行**がある。シェルで読み込むと `\n` の 2 文字として画面側・サーバー側に埋め込まれ、
     anon の読み取りが全滅した（検索・店舗ページがエラー画面、`/api/health` の supabase が NG）。以後の配信は `npm run deploy:cloudflare` だけを使う（値を trim してビルド）。
  3. Vercel は `http://` を `https://` へ 308 転送していた。Worker の入口で同じ転送を入れた。
- **応答コード 200 だけでは判断できない**（エラー画面も 200 で返る）。画面の中身で本番と比べること。
- 本番（Vercel）と確認用ホストの比較：`/search` 4 件・店舗ページ・`/osaka` が一致。`/api/health` は `healthy`（supabase・rate_limit・resend・cron すべて OK）。
  `http://` → 308、HSTS・CSP（応答ごとの nonce）・`X-Frame-Options: DENY`・`nosniff` あり。ブラウザのコンソールエラー 0。
- **CPU 時間**（`wrangler tail`・各 3 回・ミリ秒）：`/` 96/40/21・`/search` 63/39/35・`/search?area=tokyo` 65/31/30・`/tokyo` 33/22/31・
  `/osaka` 168/29/26・店舗ページ 115/67/68・`/register` 26/36/26・`/auth/login` 24/25/25・`/admin`（未ログインの転送）5/2/4。全件 `ok`・エラーログ 0。
  1 回目（起動直後）が高く、2 回目以降は 20〜70 ミリ秒。有料プランの上限（30 秒）に対して十分小さい。
- 確認用ホストでは、ログイン（Google・LINE・メールのリンク）は確かめられない（Supabase と各社に登録した戻り先が carelink-jp.com のため）。切り替え後に本人が確かめる。

### 段階 0（無料・本番に影響なし）
1. 上の部品と修正を入れたブランチを作り、Unit/lint/型検査/通常の `next build`/`build:vinext` を通す。
2. PR を作り CI を通す（本番には何も反映されない。main へのマージは本人の承認後）。

### 段階 1（本人が Workers Paid へ切り替えた後）
3. Vercel の Production の環境変数を手元の一時ファイル（権限 600）へ取り出し（`vercel env pull --environment=production`）、
   - その値を環境変数にして `npm run build:vinext`（`NEXT_PUBLIC_*` はビルド時に画面側へ埋め込まれるため）
   - `VERCEL_*` を除いた値を JSON にして `wrangler secret bulk` で Worker に登録
   - 一時ファイルを即削除する。値は画面・ログ・Git に出さない。
4. ルートを付けずに Worker（名前 `carelink`）を配信する。この時点ではどこからも届かない。
5. 確認用の一時ホスト（例 `cf-check.carelink-jp.com`）を Worker の Custom Domain として足し、公開ページ・`/api/health`・管理画面の表示・CPU 時間を確かめる。
   ※ 新しいレコードを 1 本足すだけで、本番の A / CNAME には触れない（本人の承認後）。

### 段階 2（本番の切り替え・本人の承認後）
6. Vercel の配信は止めずに残す（戻し先）。
7. `carelink-jp.com/*` と `www.carelink-jp.com/*` を Worker のルートにし、既存の A / CNAME を「プロキシ（オレンジの雲）」に変える。
   プロキシ経由になるので切り替えは即時で、TTL 待ちは無い。
8. 確認用の一時ホストを外す。

### 段階 3（切り替え後の確認）
- 公開ページ（`/`・`/search`・店舗ページ・`/register`）が 200、応答に `cf-ray` があり `server: Vercel` が無い。
- `/api/health` が `ok`（`degraded` でない）。
- `www` → アペックスへ 301。CSP の nonce が応答ごとに変わる。
- Render cron：切り替え後の `cron_logs` に、次の回（webhook-retry 15 分毎・cron-heartbeat 毎時 07/37 分）が記録される。
- ログイン（メール・Google・LINE）と管理画面：本人に実ブラウザで確かめてもらう。
- Stripe：ダッシュボードから webhook のテスト送信（本人）。LINE：Developers Console の webhook「検証」（本人）。
- Resend：本人のアドレスへのパスワード再設定メールが届く。
- `wrangler tail` で 5xx と CPU 時間を見る。

## 戻し方（いつでも 1〜2 分）

1. Cloudflare の Workers のルート 2 本を消す。
2. A `@` と CNAME `www` を「DNS のみ（灰色）」に戻す（値は `216.198.79.1` / `cname.vercel-dns.com` のまま）。
→ Vercel が引き続き配信している前提。**移行後 2 週間は Vercel のプロジェクトと配信を消さない**。
DB は移行で変更しないので、DB の戻しは要らない。

## 本人にお願いすること（順に）

- PR #873 の Cloudflare 部分を使ってよいか。
- Workers Paid（月 5 ドル）への切り替え。
- wrangler にゾーンの権限を足すための再ログイン（またはダッシュボードでのルート設定）。
- 確認用ホストの追加・本番の DNS 切り替え・main へのマージの、それぞれの承認。

## 費用で注意すること（判断は本人）

- Workers Paid：月 5 ドル。リクエスト月 1,000 万回・CPU 月 3,000 万ミリ秒まで基本料内。
- 画像の変換（`/_next/image`）は Cloudflare Images の binding を使う。無料枠を超えた変換は失敗し、`safe-image-optimizer` が元画像を返す
  （枠の大きさ・超過時の料金は切り替え前に公式の料金表で確かめる）。Images の有料プランは本人の判断なしに申し込まない。

## 未決事項（切り替え前に本人と決める）

- **main へマージした後の自動配信**：今は Vercel が Git 連携で自動配信している。切り替え後は
  (a) GitHub Actions から `wrangler deploy`（Cloudflare の API トークンを GitHub の secret に登録）か、
  (b) Cloudflare Workers Builds（Git 連携）のどちらかを用意する。用意するまでは手元から `wrangler deploy` する。
- **Vercel Speed Insights の代わり**：Worker では空の部品に差し替えている。Cloudflare 側の計測（Web Analytics 等）を使うかは別途。
- **Vercel の後片付け**：切り替え後 2 週間は戻し先として残す。その後、Git 連携の停止・プロジェクト削除は本人の承認後。
- **アカウント名の変更**：本人が後で表示名を変えたい（2026-11-05）。名前は表示だけで、Worker・ドメインはアカウント ID にひも付くため影響なし。
- **CLAUDE.md・`docs/MANUAL.md` の記載（デプロイ＝Vercel）の更新**：切り替えが済んでから行う。
