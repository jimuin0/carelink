# CareLink 地雷リスト(触れてはいけない共有物・file:行つき)

最終更新：2026年7月17日(origin/main=dfba66e4 時点で G/K を更新・初版は2026年7月15日 67b255cd)。
対象：このリポジトリ自身(医療・福祉・美容 施設向けの予約管理・集客・採用 統合マルチテナントSaaS・Next.js 15 App Router + Supabase + Vercel・決済 Stripe・LINE/LIFF・Resend・本番 https://carelink-jp.com・ブランチ【main】・GitHub jimuin0/carelink)。

⚠️【使い方】行番号はこの時点のスナップショット。src/ の変更でズレる。断定・編集の前に必ず【安定アンカー(定数名・関数名・テーブル/列名・envキー名・本番ref・cron名・migration番号)】で grep 再特定してから動く(証拠運搬者)。事実確認は `git show origin/main:<path>` を正とし、本番DBの実体は `src/lib/schema-snapshot.json` と PostgREST(service_role)/psql で照会する。

---

## A【存在しないテーブル/列参照の無音停止・最頻の事故・最重要】
- tsc は Supabase クライアントに `<Database>` 型が未配線のため列タイポを検知できない(`src/types/database.types.ts` は生成済みだが各クライアント helper に型付けされていない＝既知の恒久課題・再生成には神原さんのターミナルで `supabase login` が要る)。
- 過去の実事故：`menus`(正=`facility_menus`)・`reviews`(正=`facility_reviews`)・`facility_menus.is_active`(元々不在の列)。存在しない名前を参照すると PostgREST 400 → `data ?? []` で握り潰され無音で機能停止する。
- 【鉄則】新しいテーブル/列を参照する前に必ず `src/lib/schema-snapshot.json`(全テーブルの正)で実在を確認する。schema-drift-check cron(JST02:40)は事後検知＝事前予防にはならない。
- Supabase の embed 名(例 `menu:facility_menus(name)`)を変えたら対応する jest テストの mock も同じキー名に合わせる(ずれると片側分岐が実行されず branches 100% ゲートが崩れて CI fail)。

## B【API標準形 withRoute・骨格を崩さない】
- `src/lib/with-route.ts` `export function withRoute(handler, opts)`。内部で【この順序】＝(1)CSRF検証 `checkCsrf`(with-route.ts・import は csrf.ts・GET は opts で csrf:false)→(2)レート制限 `checkRateLimit`(with-route.ts・rate-limit.ts・Supabase RPC `check_rate_limit` 優先→失敗時 in-memory fallback で本体を500化させない fail-safe)→(3)認証(requireAuth:true で `auth.getUser()`・未認証401・通過で ctx.user/ctx.supabase 注入)→(4)ハンドラ本体→(5)例外は必ずcatchして500に変換し `safeCaptureException`＋`alertCaughtError`(Slack・fire-and-forget)。
- 🔴 catch して500を返すと `instrumentation.ts` の onRequestError に伝播せず Slack 通知が漏れる。だから catch 経路でも `alertCaughtError` で明示通知する。この二重通知の設計意図を消さない。
- Route Handler は原則 withRoute で包む。新規 API もこの骨格に乗せる。

## C【middleware・CSP・admin membership 署名キャッシュ】
- `src/middleware.ts`。全応答に per-request nonce ベースの CSP(`'strict-dynamic'`+nonce で script から `'unsafe-inline'` を排除)を付与。`x-nonce`/`x-pathname` をサーバーコンポーネントへ伝搬。
- `src/middleware.ts` `const PROTECTED_PATHS = ['/mypage', '/admin'];`。未認証は `/auth/login?redirect=...` へ。
- /admin は `facility_members` の owner/admin ロールのみ。`/admin/onboarding` は除外(施設未作成オーナーの作成導線を確保)。
- admin membership は Cookie キャッシュ：キー `_cm_mbr_{userId16}`・値を `ADMIN_COOKIE_SECRET` で HMAC-SHA256 署名・TTL300秒。未設定時はキャッシュ無効(DB都度確認)。署名検証を弱めない。
- 🔴 `src/middleware.ts` CSP connect-src の fallback に本番 Supabase project ref `xzafxiupbflvgbarrihe.supabase.co`/`wss: / ...` がハードコード。Supabase project を変えるならここも変える(変え忘れると本番で Supabase 接続が CSP で全ブロック)。

## D【cron認証・冪等前提】
- `src/lib/cron-auth.ts` `checkCronAuth`＝`Authorization: Bearer ${CRON_SECRET}` を `timingSafeEqual`(定数時間・長さ不一致は別途 false)で検証。`CRON_SECRET` 未設定は500(全cron 401/500 で停止)。
- cron ハンドラは【冪等】前提(下記 H の三重化で多重発火しても副作用が重複しないこと)。新規 cron も冪等に作る。
- 監査ログ：重要操作は `void writeAuditLog({...})`(`src/lib/audit-logger.ts`・fire-and-forget・失敗で本体を止めない)。`diffValues` で変更フィールドのみ抽出。

## E【予約の中核ロジック・動作確認済み・過剰修正禁止】
- `create_booking_atomic`(SECURITY DEFINER RPC・`src/types/database.types.ts` に型・`src/app/api/booking/route.ts` から呼ぶ)＝予約競合の原子性を担保。予約は anon INSERT でなくこの RPC 経由。
- 予約完了の副作用(customer_visits・来店ポイント)は【apply/reverse の2経路で対称】でないと本番無音バグ(PR#229 で根治)。arrived/退店レジ会計も同型。片経路だけ直すと不変条件が壊れる。
- 予約 status の遷移/値集合は `booking-status.ts` が SSOT(#313-323 で集約)。status 値をハードコードで散らさない。
- ここは grep で現状を確認し、変える時は両経路対称・回帰テスト必須。エージェントが片経路だけ見て「安全」と言っても鵜呑みにしない。

## F【schema-snapshot.json 単一ソース + drift ゲート・DDLは神原さん】
- `src/lib/schema-snapshot.json` が全テーブルの正(構造の SoT)。
- `schema-drift-check` cron(JST02:40)が本番スキーマと snapshot の差分を検知(未適用 migration による無音バグの発症前予防)。CI の Contract Tests(`jest.config.contract.js`・`npm run test:contract`)も staging ドリフトをゲート。
- 新カラム/テーブルは migration 先(`supabase/migrations/NNNN_*.sql`)→snapshot 更新→code 後、の順。列ドリフトは types でなく migration を本番に合わせる(migration↔本番ドリフトの解消)。
- 🔴【DDL(CREATE/ALTER/トリガ/制約/RLS)は神原さんが Supabase SQL Editor で実行】。Claude は直接 ALTER/CREATE しない。提示は【ツール(Supabase SQL Editor)・SQL全文(冪等)・確認SELECT】をセットで。SELECT/INSERT/UPDATE/DELETE と Render ログ確認は service_role 鍵等で Claude 可(2026年7月4日決定)。適用後は PostgREST/psql で pg_policies/情報スキーマを実照会して裏取り(「Success. No rows returned」を鵜呑みにしない)。

## G【外部送信ヘルパーの false 契約・送達フラグの無音ミス】
- `sendLineText` 等の LINE/LIFF 送信ヘルパーは失敗時に throw せず【false を返す】(`send-helpers-false-contract` メモ)。戻り値を無視して送達フラグ(送信済み等)を立てると無音の恒久ミス(PR#232)。
- Resend メール送信も結果を確認してからフラグを立てる。メール系 cron は RESEND_API_KEY/EMAIL_FROM 未設定で送信スキップ(スキップ理由は観測可能に・PR#464)。EMAIL_FROM ドメイン不正は本番で送信失敗の一因(2026年7月9日の神原対応事項)。
- webhook-retry cron は【未配信ジョブを success に倒さない】(サイレントデータロス・PR#468 で throw→scheduleRetry に根治)。配信結果を確認してから status を更新。
- 【cron の claim は真のCASパターンを崩さない(2026年7月17日 #503/#504/#505/#506 で全cron統一)】webhook-retry=claim時に claimed_at 記録・reclaim判定も claimed_at 基準(scheduled_at 流用は二重配信の温床・#505)／booking-reminder=upsert(ignoreDuplicates).select() の戻り件数が原子的勝敗判定(30秒ヒューリスティック禁止・#503)／birthday-coupon 通知=claim-first(送信前に birthday_notifications INSERT・23505=負け・送信失敗は claim DELETE 解放・#504)／customer-segment=at_risk クーポンは部分UNIQUE uq_user_coupon_codes_at_risk_daily が物理封鎖・23505=claim負けとして送信スキップ(#506)。新規 cron の送信系は必ずこのどれかの型に乗せる。enqueueWebhook は insert の {error} を必ず捕捉(PostgRESTはDBエラーでthrowしない・#505)。

## H【cron三重化(GitHub Actions + pg_cron + Render Cron Jobs)＝移行中(2026年7月3日〜)】
- 背景：public repo の GitHub Actions scheduled workflow は GitHub が private/有料を優先し大幅に間引く(実測で cron.yml 最大176分の空白)。恒久解として Render Cron Jobs(`render.yaml`・機能ごと独立サービス・SSOT=`src/lib/cron-jobs.data.json`・`src/__tests__/render-yaml-drift.test.ts` がドリフト検知)を新設(PR#382)。
- 現状：Render 稼働を実データ(Render UI)で確認できるまで、GitHub Actions `cron.yml` と pg_cron(Supabase `cron.job` の `carelink-*` prefix・15ジョブ)を【あえて残置】(endpoint冪等で三重発火は無害だが無駄)。
- 一本化の順(Render稼働を実データ確認後・神原SQL・段階移行で空白を作らない)：(1)`cron.yml`/`health-monitor.yml` 廃止 (2)`select cron.unschedule(jobname) from cron.job where jobname like 'carelink-%';` で pg_cron 撤去。
- 🔴 cronの挙動を調べる時は、まず【どのスケジューラが実際に動いているか】(Render Dashboard / GitHub Actions run history / `select * from cron.job`)を確認してから議論する。
- 主要 cron(cron.yml・UTC/JST)：booking-reminder(毎日00:00) / daily-summary(毎日15:00) / review-request(毎日03:00) / birthday-coupon(毎日23:00) / flag-reviews(毎時) / waitlist-notify(毎時30分) / webhook-retry(15分毎) / schema-drift-check(毎日02:40) 他。
- オーナーニュースレターの【自動月次配信は廃止】(神原さん確定 2026年7月2日「お知らせがある時のみ」)。旧 newsletter-digest エンドポイント・専用ワークフロー・monthly-batch-watcher は削除済み。配信は管理画面 `/admin/newsletters` からの手動送信のみ。台帳 newsletter_send_log は孤児化するが drift 整合のため残置(無害)。

## I【金銭/認可=fresh Sonnet で敵対検証必須】
- 対象：Stripe 決済・価格計算・ポイント/クーポン/パッケージ・GET系IDOR(facility_id/user_id で一貫スコープ・admin22＋v1＋ical/review)・admin変異ハンドラの0行時挙動。
- admin変異ハンドラは0行時に【404/409】を返す(500 や phantom success にしない・PR#465で `.single()`→`.maybeSingle()`・PR#470 で8本を404/409に根治)。新規 `if(!data)→404` 分岐は data=null のテスト必須(branches 100% ゲート)。
- 一般応募(job_posting_id 無し)の重複チェックは `.eq('job_posting_id', null)`(=`eq.null`・NULL 行に一致しない)でなく `.is()` を使う(二重応募すり抜け・PR#469)。
- 顧客生年月日等の日付は実在暦日(2026-02-30 等)を弾く `.refine(isValidIsoDate)`(customerSchema.birthday・booking_date と同型・PR#467)。
- 検証手順：fix を外して該当テストが【赤】になることを確認→復元。テスト有効性検証は直列1セット(破壊→pytest/jestで赤確認→復元→grep で破壊値0)を完了させてから commit(他編集・push と並行しない)。

## J【route.ts export 制約・CIすり抜けの罠】
- `src/app/**/route.ts` は HTTP メソッド(GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS)と一部 config 以外を export できない。
- 共有ヘルパー関数を route.ts に足すと tsc/jest/lint は通るのに `next build`(=Vercel デプロイ・E2E も内部依存)だけ `"xxx" is not a valid Route export field` で Failed to compile する。
- Unit/Lint/Contract/Security 全 pass なのに Vercel/E2E だけ fail する時は、まず `npx next build` をローカル実行してこれを疑う。共有関数は `src/lib/*.ts` に置き route.ts はメソッドのみ import して使う。

## K【CI安全網・worktree の罠】
- CI(ci.yml)：Lint&TypeCheck / Unit+Coverage(branches100/lines80/functions75/statements80・測定=src/lib/**/*.{ts,mjs}＋src/app/api/**/*.{ts,tsx}) / E2E(Playwright chromium/webkit) / Security Audit(npm audit high) / Contract Tests。静的ガード＝cron-constraints/anon-write-policy-lint/secdef-search-path-lint/actionlint。L4=mutation-l4.yml(Stryker・tsconfigFile=tsconfig.stryker.json・timeoutMS300000)。
- 🔴 worktree で `ln -s <本家checkoutのnode_modules> ./node_modules` している場合、`node_modules/eslint-plugin-carelink-safety` も本家へのリンクになる。worktree 内でこのプラグインを編集してもローカル lint は本家未修正版を読む(PR#397 事故・CIで初めて317件 error)。編集するなら `unlink node_modules/eslint-plugin-carelink-safety`→worktree 実体へ張り替えてから lint。
- マージ後の `gh pr merge --delete-branch` のローカル cleanup は main worktree 占有で失敗しがちだが、サーバー側マージ自体は成功。`git worktree remove --force` を別途実行。
- 🔴【symlink宙吊りは #507 のガードが自動修復】scripts/ensure-eslint-plugin-link.mjs が prelint/pretest/postinstall で「宙吊りのみ」正規リンク(../eslint-plugin-carelink-safety)へ自動修復(解決可能な意図的張り替えは触らない)。真因は【本家checkoutの放置】＝pluginが旧版になりorigin/mainのlint設定と不一致→作業者が張り替えを強いられる。本家checkoutを古いまま放置しない。worktreeのnode_modulesがディレクトリsymlinkの場合、pluginリンク張り替えは物理的に本家を書き換える(「本家無変更」は誤認)。
- 🔴【migration番号は並行セッションと衝突する(2026年7月17日 実発生)】同日に複数セッションがmigrationを作ると同番号(例 20260717000001)が衝突する。push/マージ前に必ず `git ls-tree origin/main supabase/migrations/ --name-only | grep <当日日付>` で使用済み番号を確認し空き番号を取る。
- 【CIチェックのポーリングは2形式ある】GitHub Actions系=check-run(conclusion/status)・Vercel=commit status(state)。conclusion==null だけで「未完了」と数えるとVercel SUCCESSを永遠に待つ誤判定になる(2026年7月17日 実発生)。判定は `(.conclusion // .state)` で両形式を吸収する。required checks は Lint&Type Check/Security Audit/Unit Tests+Coverage の3本(strict=true)＝並行セッションがマージする度に BEHIND→update-branch が要る。

## L【店舗ログインの仕様(繰り返し問われる)】
- `auth.users` に「客/店舗」区別フィールドは無い。全員ただの Supabase 認証アカウント。「店舗」＝`facility_members` に role=owner/admin の行があるかだけで決まる(`src/app/admin/layout.tsx`)。
- ログイン(`/auth/login`)後の既定リダイレクトは `/mypage`(客向け)。店舗オーナーでも最初は客画面に見えるため店舗管理は `/admin` に直行が必要。
- 店舗化フロー：`/register`→`/auth/signup?redirect=/admin/onboarding&...`→`/admin/onboarding` が `/api/facility/setup` を呼び facility_profiles(draft)＋facility_members(owner) を作成。
