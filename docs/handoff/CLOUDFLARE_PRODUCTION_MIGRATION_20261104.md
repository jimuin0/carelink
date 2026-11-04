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

## Cloudflare アカウントの分離（2026-11-04 本人決定）

本人の判断「今のアカウントで別プロジェクトも動いているので、carelink 専用アカウントを作る」により、
Worker と carelink-jp.com を新しい `carelink` アカウントへ置く。carelink-jp.com は今のアカウント
（tokuhal.jimuin0@gmail.com's Account・`d7cef176…`）の **Cloudflare Registrar で登録**され、DNS もそこにある。
Worker のルートはゾーンと同じアカウントにしか付けられないので、**ドメインの移動が先**になる。

公式手順（https://developers.cloudflare.com/registrar/account-options/inter-account-transfer/ ・2026-04-24 更新）の要点：
- 移動先（carelink）にドメインを website として追加し、プランを選んでおく（ゾーンは自動では作られない）。
- 移動元で DNSSEC を切る（現状は `disabled` で対応不要）。
- 移動元の Manage Domain > Configuration から申請 → 移動先アカウントに届くメールで 5 日以内に承認。
- **移動元の設定はすべて失われる**。DNS レコード・Email Routing・SSL 設定は移動先で作り直す。移動後 30 日は他社へ移管不可。

### 移動前の控え（2026-11-04 取得・Git には入れない）
DNS 11 本（A `@`→Vercel・CNAME `www`→Vercel・MX 3 本＝Cloudflare Email Routing・`send` の MX/SPF＝Resend(SES)・
SPF・DKIM 2 本（Email Routing／Resend）・DMARC）、DNSSEC `disabled`、SSL `full`、
Email Routing 有効（`support@carelink-jp.com` → 本人の Gmail へ転送）。値は作業者の手元の控えファイルに保存。

### 移動の手順（当日・本人の承認後）
1. carelink アカウントにドメインを追加（プラン Free）。追加時の自動取り込みは使わず、控えた 11 本を**DNS のみ（灰色）**で先に入れる。
2. carelink アカウントで Email Routing を有効にし、転送先（本人の Gmail）を登録・確認する（確認メールのクリックは本人）。
3. SSL を `full` に合わせる。
4. 移動元で移動を申請 → 本人が承認メールで承認。
5. 直後に確認：`dig` で A/CNAME/MX/TXT が控えと一致・https://carelink-jp.com が 200（まだ Vercel）・`support@` 宛のテストメールが届く・Resend の送信。
戻し方：移動が成立する前なら申請を取り消す。成立後は移動元へ同じ手順で戻す（30 日ロックは他社移管のみで、Cloudflare アカウント間は要確認）。

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
- **CLAUDE.md・`docs/MANUAL.md` の記載（デプロイ＝Vercel）の更新**：切り替えが済んでから行う。
