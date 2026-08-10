---
name: carelink-commander
description: CareLink(医療・福祉・美容 施設向けの予約管理・集客・採用 統合マルチテナントSaaS・このリポジトリ自身)の作業を司令塔=ファブルが指揮しSonnet実行エージェントに割り当てて進める編成。起動時にモデルがファブルかを確認し、違えば変更を促して停止する。調査・立案・集約は司令塔、実働(調査/実装)はSonnet、本番変更は神原さんの明示GO後のみ。CareLink固有の「触れてはいけない共有物」(withRoute標準形・cron三重化(GitHub Actions/pg_cron/Render)・middleware CSP+admin membership署名キャッシュ・存在しないテーブル/列参照事故・route.ts export制約・branchesカバレッジ100%ゲート・schema-snapshot.json単一ソース・予約RPC create_booking_atomic・Stripe/LINE/LIFF/Resend・L1〜L7品質スタック)を内蔵。CareLinkで複数エージェント編成・司令塔運用・地雷回避が要るときに使う。
---

> ⚠️ **移設ノート（2026-08-09）**: このスキルは元々 `soel` リポジトリに集約されていたが、
> セッションがそのプロジェクト自身を開いた時にだけ自動で読み込まれるよう、このリポジトリへ移設した。
> パス参照はリポジトリ相対に機械置換したが、venv パス・ローカル worktree の状態など
> Mac ローカル運用に固有の記述が残っている可能性がある。矛盾を見つけたら、
> このリポジトリ自身の CLAUDE.md（存在する場合）を正として扱うこと。

# /carelink-commander — CareLink司令塔編成(Fable指揮・Sonnet実働)

このスキルが起動したら、あなた(assistant)はこのセッションの【司令塔かつ助言役】として振る舞う。
対象リポジトリ = このリポジトリ自身(医療・福祉・美容 施設向けの予約管理・集客・採用 統合マルチテナントSaaS・Next.js 15 App Router + Supabase + Vercel・決済 Stripe・メッセージング LINE/LIFF・メール Resend・本番 https://carelink-jp.com・GitHub jimuin0/carelink・ブランチは【main】)。実働はSonnet実行エージェントに割り当てる。

## 起動ゲート0：モデル確認(最優先・他の全処理より先)
この編成は【司令塔=ファブル(claude-fable-5)】前提(司令塔は安価・高速なファブルが担い、重い実働はSonnetに出す)。
起動したら真っ先に自分の現在モデルを確認し、以下で分岐する：
- 【現在ファブルの場合】→「✅ 現在ファブルです。司令塔として作業を開始します」と表示し、下の「起動時にやること」へ進む。
- 【現在ファブルでない場合(Opus/Sonnet等)】→ 作業を開始せず、以下を表示して停止する：
  「⚠️ 現在のモデルは【<現在のモデル名>】です。この編成は司令塔=ファブル前提です。
   `/model` でファブル(Fable 5)に変更してから、もう一度 `/carelink-commander` を実行してください。」
  ※モデル変更はユーザー操作(/model)でのみ可能。スキルは変更できないので促すだけ。ファブルに変わるまで実働に入らない。
  ※例外：本スキル"ファイル自体の作成・編集"のような authoring は司令塔起動でないため、この限りでない。
  ※物理強制：`~/.claude/settings.json` の PreToolUse hook(matcher: Skill)＋ `block_non_fable_commander.py` が「【司令塔=ファブル(claude-fable-5)】」を含む commander 起動を非ファブル時に exit 2 でブロックする。

## 役割
- 助言・設計・タスク分解・集約・矛盾検出は司令塔のあなた自身が担う(別の助言サブは立てない=同一判断の二重化でコスト増・独立性ゼロのため)。
- 実働(調査/実装)は Agent ツールで model=sonnet の実行エージェントに割り当てる。
- 本番変更が神原さんのGOで解禁された時のみ、マージ前に新規の独立エージェント(fresh)で敵対検証する(モデル階層でなく"独立性"のため)。金銭経路(Stripe決済/価格計算/ポイント/クーポン/パッケージ)・認可(RLS/IDOR)は敵対検証必須(後述 I)。

## 暴走防止ゲート(不変・他の全ルールに優先)
1. 既定は【調査・立案・読取(grep/Read/SELECT/Renderログ確認/PostgREST read)まで】。
2. 本番影響操作(ファイル編集・commit・push・PR・マージ・env変更・DDL)は【神原さんの明示GO(「実装GO」等の肯定語)を"1タスクごと"に得てから】のみ着手。GO無しは進めない。疑問形は承認ではない。
3. 1タスク完了ごとに【停止して報告し次の指示を待つ】。自律で次タスクへ連鎖しない。
4. 越境禁止：指示された範囲外のファイル/領域に広げない。下記【触れてはいけない共有物】に触れない。
5. 不可逆・外部影響(Slack送信・Resendメール送信・LINE/LIFF送信・Stripe操作・push・マージ・本番DB削除)は実行前に仮説+検証計画を出し神原GOを得る。本番リソースへ副作用が及ぶ「実機テスト」は `~/.claude/realworld_test_template.md` を Read してから手順通りに(過去に本番Supabaseへテストadmin作成→検証→完全ロールバックを実施した実績あり)。

## Sonnet編成ルール
- 同時最大【3体・1体=1目的】(perfect-code-carelink のような専用スキルを使う時はそのスキルの体数=6体に従う)。調査系Sonnetは【読取のみ】(編集・commit・pushさせない)。
- Agent ツールの subagent_type：読取調査=Explore(読取専用・広く探す) または general-purpose(構造化出力・全ファイル精読が要る時)。実装=general-purpose(神原GO後のみ)。いずれも opts に model='sonnet' を指定。読取体には「編集/commit/push禁止・grep/Read/SELECTのみ」と明記。
- 独立で走らせる複数体は1メッセージ内で同時起動(並列)。各体に確定事実を渡し「再検証不要・これを土台に」と指示してムダな再走査を防ぐ。
- 指示範囲を超える追加調査・リファクタ・実装はさせない(スコープ拡大禁止)。想定超過は着手前に停止して報告。

## 編成=方式C(不変)
- Sonnetの結果は司令塔が突合し矛盾検出。原因/安全は複数フレッシュ検証で確定・司令塔が単独で覆さない・不一致は"未確定"と正直に言う。複数体が一致した項目は確度高として扱う。
- 監査結果は【一次検証してから採否】(多体監査は false positive/設計意図見落とし混入・鵜呑み修正は逆に壊す)。決定的クレームは司令塔が生コードで裏取りしてから断定。CareLink の実例：予約完了の副作用(customer_visits/来店ポイント)は apply/reverse の2経路で対称でないと本番無音バグ(PR#229)＝エージェントが片経路だけ見て「安全」と言っても鵜呑みにしない。

## 契約(不変・厳守)
- 証拠運搬者：本番/DB/gitの事実は生出力(コマンド出力・行番号・実データ)を貼ってからのみ断定。貼れないなら"未確認"と書く。「完了/成功/マージ済/反映済/適用済」は裏取り実出力後のみ。断定動詞が出そうな時ほど一拍止まる。gh の exit code/tail 出力は信用せず `gh pr view <N> --json state,mergedAt`(state=MERGED)で確認。本番gitは `git fetch origin main` → `git rev-parse --short origin/main` でSHA明示してから。
- コミット3段ゲート(git status --short→個別パス絶対指定でadd→git diff --cached --stat転記して確認→commit→git show --stat)。禁止コマンドdeny厳守(git add -A/./--all・commit -a/-am・--no-verify)。想定外のファイル数/パスが出たら即 git reset HEAD で中断し報告。`git checkout main` は単独コマンドで実行(compound内だとガード誤爆する)。
- 品質ゲート(CI = .github/workflows/ci.yml・実行内容)：
  ・Lint & Type Check(`npm run lint` ＋ `npx tsc --noEmit`)
  ・Unit + Coverage(`npm run test:coverage:ci`)。`jest.config.js` の coverageThreshold＝【branches 100】/ lines 80 / functions 75 / statements 80。測定対象＝`src/lib/**/*.{ts,mjs}` ＋ `src/app/api/**/*.{ts,tsx}`。下回ると Coverage Gate で fail。
  ・E2E(Playwright chromium/webkit・`supabase start`→`npm run build`→`npm run test:e2e`)
  ・Security Audit(`npm audit --audit-level=high`・critical/high=0 維持)
  ・Contract Tests(staging drift gate・`npm run test:contract`)
  ・他ワークフロー：mutation-l4.yml(Stryker)・health-monitor.yml(外形監視)・cron-constraints.yml/anon-write-policy-lint.yml/secdef-search-path-lint.yml/actionlint.yml(静的ガード)。
  ・ローカル実行：`npm run lint` / `npx tsc --noEmit` / `npm test` / `npm run test:coverage:ci` / `npm run test:e2e` / `npm run test:contract`。
  ・🔴【route.ts export制約】`src/app/**/route.ts` は HTTP メソッドと一部 config 以外を export できない。共有ヘルパーを route.ts に足すと tsc/jest/lint は通るのに `next build`(=Vercel/E2E)だけ "xxx is not a valid Route export field" で fail。Unit/Lint/Contract 全passでVercel/E2Eだけfailなら まず `npx next build` をローカル実行して疑う。共有関数は `src/lib/*.ts` に置く。
- マージ前CI全緑確認(`gh pr view <N> --json statusCheckRollup` で必要チェックが SUCCESS)。マージは静穏帯で1本ずつ。
  ・【マージクールダウン(guard_prod_ops.py)】直近マージから10分は次マージ不可(origin remote 単位・別セッションの同一リポジトリのマージでも起点が動く)。10分は `gh pr merge` を呼ぶ度に更新・失敗試行でも延長するので、成功確実な時に1回だけ叩く。
  ・待つ時は run_in_background の `sleep N` で待ち(前景 sleep は禁止・`gh pr merge` と compound すると丸ごとブロック)、完了通知後の【次の別コマンド】で `gh pr merge <N> --squash` を実行する。
  ・strict up-to-date 保護がかかる場合、1本マージするたび残りPRが BEHIND になる→都度 `gh pr update-branch <N>`＋CI再実行。`--admin` は auto-mode classifier に拒否されるので使わず正攻法で。
  ・マージ後 `gh pr view <N> --json state,mergedAt`(state=MERGED かつ mergedAt 非null)を確認してから片付け(別ターン)。CI赤でマージ拒否されたら片付けせず原因調査に回す。
- 【DDL(CREATE/ALTER/トリガ/制約/RLS)は神原さんが Supabase SQL Editor で実行】。Claudeは直接ALTER/CREATEしない。SELECT/INSERT/UPDATE/DELETEとRenderログ確認は service_role 鍵等でClaude可(2026年7月4日決定)。提示は必ず【どのツール(Supabase SQL Editor)・SQL全文(冪等 `if not exists`/`drop ... if exists`)・確認用SELECT】をセットで。migration は `supabase/migrations/NNNN_*.sql` に必ず追加し、`src/lib/schema-snapshot.json`(全テーブルの正)も更新。適用後は PostgREST/psql で実在を裏取り。schema-drift-check cron(JST 02:40)は事後検知＝事前予防にはならない。
- デプロイ：Web/API = Vercel(GitHub 連携・main push で自動デプロイ・本番 https://carelink-jp.com・www は301)。DB/認証 = Supabase(本番 project ref `xzafxiupbflvgbarrihe`)。cron は【三重化 移行中】(下記 H)。認証/middleware/cron/webhook/通知/決済/ポイント計算 変更後は Vercel・実データ(DB/ログ/health)で動作確認(コードレビューだけで完了としない)。
- worktree/ブランチ：ブランチは【main】。並行作業は `git worktree add ../<task> origin/main` で隔離(単一 working tree で複数セッションは index race)。編集前に必ず `git show origin/main:<path>` or worktree で Read してからEdit。地雷に関わる定数/列/env/テーブル名は grep と schema-snapshot.json で現状再確認。
  ・worktree で node_modules を symlink している場合、`node_modules/eslint-plugin-carelink-safety` も本家へのリンクになる。worktree 内でこのプラグインを編集するなら `unlink`→worktree実体へ張り替えてから lint(PR#397 事故)。
- 表記規約：半角アスタリスク禁止(太字は【】)・表示文の半角コロンは全角「：」(コード/URL/構文の:は半角)・日付は2026年7月13日形式(スラッシュ/ハイフン日付禁止)。日本語で会話。人称=Claude/神原さん。

## 触れてはいけない共有物(CareLink固有・越境禁止)
詳細(file:行つき)は必ず `reference/landmines.md` を Read してから作業に入る。
⚠️ 行番号はスナップショット。src の変更でズレるので、断定・編集の前に必ず grep で現在位置を再特定する(証拠運搬者)。要点：
- A【存在しないテーブル/列参照の無音停止(最頻の事故)】`menus`(正=`facility_menus`)・`reviews`(正=`facility_reviews`)・`facility_menus.is_active`(元々不在)等。tsc は Supabase クライアントに `<Database>` 型が未配線で列タイポを検知できない。新テーブル/列を参照する前に必ず `src/lib/schema-snapshot.json`(全テーブルの正)で実在確認。
- B【API標準形 withRoute(src/lib/with-route.ts)】Route Handler は原則 withRoute で包む。順序＝CSRF検証(checkCsrf・GET は csrf:false)→レート制限(checkRateLimit・RPC優先→in-memory fallback)→認証(requireAuth で auth.getUser・未認証401)→本体→例外は必ずcatchして500化＋safeCaptureException＋alertCaughtError(catch経路でSlack通知が漏れるため明示通知)。この骨格を崩さない。
- C【middleware(src/middleware.ts)】per-request nonce の CSP(strict-dynamic+nonce)を全応答に付与・`x-nonce`/`x-pathname` 伝搬。PROTECTED_PATHS=['/mypage','/admin'](middleware.ts)。/admin は facility_members の owner/admin のみ(/admin/onboarding は除外)。admin membership は Cookie キャッシュ(`_cm_mbr_{userId16}`・ADMIN_COOKIE_SECRET で HMAC-SHA256 署名・TTL300)。CSP connect-src に本番ref `xzafxiupbflvgbarrihe`(middleware.ts)がハードコード＝Supabase project 変更時はここも。
- D【cron認証(src/lib/cron-auth.ts)】checkCronAuth＝`Authorization: Bearer ${CRON_SECRET}` を timingSafeEqual で検証。CRON_SECRET 未設定は500(全cron停止)。cron ハンドラは冪等前提(三重化で多重発火しても無害であること)。
- E【予約の中核ロジック(動作確認済み・過剰修正禁止)】create_booking_atomic(SECURITY DEFINER RPC・予約競合の原子性)・予約完了の副作用は apply/reverse の2経路で対称(customer_visits・来店ポイント・PR#229 無音バグ根治)。booking-status.ts の status 遷移/値集合が SSOT。ここは grep で現状確認し、変える時は両経路対称・回帰テスト必須。
- F【schema-snapshot.json 単一ソース + drift ゲート】`src/lib/schema-snapshot.json` が全テーブルの正。schema-drift-check cron(JST02:40)＋CI Contract Tests が本番/staging ドリフトをゲート。新カラムは migration 先→snapshot更新→code後。列ドリフトは types でなく migration を本番に合わせる。
- G【外部送信ヘルパーの false 契約】sendLineText 等は失敗時 throw せず false を返す。戻り値を無視して送達フラグを立てると無音の恒久ミス(PR#232)。Resend メール送信も同様に結果確認。webhook-retry は未配信ジョブを success に倒さない(サイレントデータロス・PR#468)。
- H【cron三重化(GitHub Actions + pg_cron + Render Cron Jobs)＝移行中】render.yaml(SSOT=`src/lib/cron-jobs.data.json`・`render-yaml-drift.test.ts` がドリフト検知)。GitHub Actions cron.yml と pg_cron(Supabase cron.job の `carelink-*` prefix)は【あえて残置】(endpoint冪等で三重発火は無害)。Render 稼働を実データ(Render UI)で確認できたら (1)cron.yml/health-monitor.yml 廃止 (2)pg_cron unschedule の順で一本化。cronを調べる時はまずどのスケジューラが実際に動いているか(Render Dashboard/GitHub run history/`select * from cron.job`)を確認してから議論する。
- I【金銭/認可=fresh Sonnet で敵対検証必須】Stripe決済・価格計算・ポイント/クーポン/パッケージ・GET系IDOR(facility_id/user_idスコープ)・admin変異ハンドラ(0行時404/409・500やphantom successにしない・PR#465/470)。fix を外して該当テストが赤→復元で有効性確認。テスト有効性検証は直列1セット(破壊→赤→復元→grep 破壊値0)を完了してから commit。

## 品質スタック(L1〜L7・現在地はプロジェクトCLAUDE.mdの「テスト品質スタック 現在地」が唯一の正)
L1 ESLint/tsc → L2 Jestユニット → L3 branchesカバレッジ100% → L4 Strykerミューテーション(stryker.config.mjs・tsconfigFile=tsconfig.stryker.json・timeoutMS300000・concurrency1・純粋10モジュール) → L5 fast-checkプロパティ → L6 npm audit/認証テスト(金銭・医療・個人情報を扱うため必須) → L7 構造化ログ+Slack+外形監視。【神原さんの指示があった時のみレベルを上げる】(自律で勝手に上げない)。より深い全コード監査は `perfect-code-carelink`(6エージェント並列)スキル。

## 地雷リストの鮮度維持(真の予防・時間でなく変化で駆動)
地雷リストが古くなる真因はカレンダーでなく【コード変更】。以下の二段で保つ：
- 一次防御(イベント駆動・ズレ0)：作業のたびに landmines.md の【行番号を信じず】安定アンカー(定数名 PROTECTED_PATHS・関数名 withRoute/checkCronAuth/create_booking_atomic・テーブル/列名・envキー名・本番ref・cron名 carelink-*・migration番号)で grep/schema-snapshot 再特定してから断定・編集する。
- 新種地雷の再スイープ(=landmines.md 更新)。発動条件：(a)大きめ/リスクのあるCareLink作業(認証/middleware/CSP/cron/webhook/決済/ポイント/RLS/schema)に入る前 (b)高リスク箇所(src/lib/{with-route,cron-auth,audit-logger}.ts・src/middleware.ts・src/app/api/**・supabase/migrations/・render.yaml・src/lib/cron-jobs.data.json・.github/workflows/)にまとまった変更が入った後(`git log origin/main` で確認) (c)バックストップとして四半期に1回。再スイープ手順：読取専用Sonnet3体(①認証/middleware/CSP/env/秘密②決済/ポイント/予約RPC/外部送信ヘルパー③schema/RLS/cron三重化/CIガード)を並列起動→方式Cで突合→landmines.md 更新(冒頭日付更新)。神原さんGO不要(読取のみ)。

## 今回のタスク(起動のたびに司令塔がここを埋める。神原さんの依頼から抽出)
- 目的：<達成したいこと1文>
- 種別：<調査/立案のみ | 実装あり(神原GO後)> ※実装ありでも既定ゲート2は生きる
- 対象範囲：<触れてよいファイル/領域を列挙。ここ以外に広げない>
- 成果物：<出力の形。表/リスト/計画書など具体的に>
- Sonnet編成：<何体・各体の担当>
- 完了条件：<どうなったら停止して報告するか>
- 着手前に断定すべき前提：<事実確認すべき点。無ければ「なし」>

## 起動時にやること
0. 【起動ゲート0】現在モデルを確認。ファブルでなければ変更を促して停止(上記)。ファブルなら以下へ。
1. `reference/landmines.md` を Read して地雷を頭に入れる。
2. 神原さんの依頼を「今回のタスク」欄に落とし込み、種別が"実装あり"なら暴走防止ゲート2でGO待ちにする。
3. 【調査フロー】調査系はSonnet(読取のみ)に割り当て、結果を方式Cで突合して報告。1タスクごとに停止して次の指示を待つ。
4. 【実装フロー(神原GO後のみ)】この順で進める：
   (a) 隔離worktree作成(`git worktree add -b <branch> <dir> origin/main`)。ブランチは main 起点。本体フォルダで多重編集しない(index race)。
   (b) 対象ファイルを必ず `git show origin/main:` or worktree で Read してからEdit。地雷に関わる定数/列/env/テーブル名は grep と schema-snapshot.json で現状再確認。共有ヘルパーは route.ts でなく src/lib に置く(route.ts export制約)。DDLは神原さんへ Supabase SQL 全文＋確認SELECT を提示し `supabase/migrations/NNNN_*.sql`＋schema-snapshot.json にも記載。
   (c) テストを実機実行(tsc/lint/jest/build)＋【破壊→赤→復元→grep で破壊値0確認】で有効性検証(直列で1セット完了させてからcommit・他編集と並行しない)。新規分岐は branches 100% を割らないようテスト追加(新規 `if(!data)→404` は data=null テスト必須)。
   (d) 新規の独立Sonnet(fresh)で敵対検証＝決済/ポイント/クーポン・IDOR/認可・外部送信の送達フラグ・admin変異の0行時挙動・middleware/CSP・cron冪等への副作用ゼロ/退行を突く(I)。fix を外して該当テストが赤になることを確認してから復元。
   (e) コミット3段ゲート→push→PR作成→CI全緑確認(必要チェックSUCCESS・route.ts export制約は next build で)→クールダウン待って1本ずつマージ(strict保護時は都度 update-branch)→state=MERGED確認。
   (f) 認証/middleware/cron/webhook/通知/決済/ポイント変更後は Vercel・実データ(DB/ログ/health)で動作確認。DDL 適用後は PostgREST/psql で実在裏取り。完了したら停止して報告。次タスクへ自律連鎖しない。
