# CareLink 再開条件・残作業・完了証拠

確認日：2026年9月26日

読み方：第1〜8節は再開条件を調査した時点の記録。続く実装依頼の契約と実行証拠は第9節以降へ時系列で追記している。古いSHA、未接続、未変更などの記述を現在状態として扱わない。

## 1．今回の依頼と結論

原依頼：

> 全部解決するためにはどうすればいい？何が足りていない？教えてくれた足りていないもののみを実行して、全部修正できるように解像度をMAXに上げて教えて

今回の契約 ID：CARELINK-RESUMPTION-READINESS-20260926、revision 1。

今回の目的は、修正再開を妨げている条件の検証・解消と、実装から本番確認までの不足条件の明確化。アプリ全修正とは別の成果物である。今回実行したのは、規則解決、ローカル状態・GitHub・CIの読取、既存修正との突合、ブラウザ接続確認、この記録の追加。アプリ、DB、共通規則、CI設定は変更していない。commit、push、merge、deploy、顧客への送信もしていない。

結論：追加のGO、rulesetの新設、神原さんによるファイル配置は必要ない。共通規則とGit契約は既存の正規リンクから解決できる。従来の「規則を取得できないため全工程を停止」という説明は現在の環境には当てはまらない。通常のローカル修正・検証を再開できる。本番確認には別の未充足条件があるが、ローカル作業の停止条件ではない。

今回の受入条件と証拠：

| 要求 | 証拠・結果 |
|---|---|
| 何が不足か特定する | 第4節で開始条件・実装残作業・本番確認・経営判断を分離 |
| 解消可能な前提をAIが解消する | r39と全7構成hash照合、正しいcheckout・PR・GitHub権限・CIの特定 |
| 不足部分だけを扱う | アプリ・本番・共通規則への書込みなし。追加は本書のみ |
| 利用者の作業を保持する | 元checkoutの未追跡ファイルを保持。PR checkoutは開始時clean |
| 再開方法を具体化する | 第5〜8節で実装単位、テスト、成果物、終了条件を固定 |
| 事実と未確認を区別する | CI成功を本番解決と扱わず、ブラウザtimeoutを認証切れと扱わない |

費用：今回は追加費用を発生させる操作なし。今後も有料契約・プラン変更は行わない。

## 2．規則と作業対象の正しい参照先

### 共通規則

- user-level入口：`/Users/kanbararyousuke/.codex/AGENTS.md`
- 入口が参照する共通本文：`/Users/kanbararyousuke/.ai-rules/current/release/CLAUDE.md`
- manifest：`/Users/kanbararyousuke/.ai-rules/current/release/AI_RULESET_MANIFEST.md`
- version：2026年9月16日-r39
- manifest SHA-256：`6f6f1dc76d9ed552e1f61c2ce93afcc4435229754ca37086396ae0397df7871b`
- immutable release：`/Users/kanbararyousuke/.ai-rules/releases/2026年9月16日-r39-6f6f1dc76d9ed552e1f61c2ce93afcc4435229754ca37086396ae0397df7871b`
- 共通本文、準備、品質、実機、副作用、Git local、Git remoteの7ファイルすべてmanifest記載のhashと一致。
- 準備・品質・Git local・Git remoteは今回全文確認。実機・副作用契約は対象効果の計画・実行前に全文適用する。hash照合だけを読了や高リスク承認の代わりにしない。
- CareLink専用スキルと地雷資料を適用。古いスキル記載のcron三重化と現在のプロジェクト記録は相違するため、本番schedulerは実体で再判定する。スキルや規則そのものは改訂しない。

### コードとPR

| 項目 | 今回確認した値 |
|---|---|
| 元checkout | `/Users/kanbararyousuke/Projects/carelink` |
| 元checkout HEAD | `d27c6f5fd311c4fa4ad46164b267b8cba6a9fa0b` |
| 実装再開用checkout | `/Users/kanbararyousuke/Projects/carelink-ops-remediation-20260921` |
| 作業branch | `codex/ops-remediation-20260921` |
| PR | https://github.com/jimuin0/carelink/pull/642 |
| PR HEAD | `74feca59cf5b46e7db59faf1250f17bc2af59e0d` |
| 確認時のremote main | `a07be59216f177a4f2a90d2cd39c08710d2eb749` |
| PR状態 | OPEN、BEHIND、未マージ。mainに対してahead 17／behind 7 |
| PR checkoutの開始時差分 | tracked・staged・untrackedとも0。以前の未commit説明は現在状態ではない |
| GitHub接続 | 認証有効、対象repoのviewerPermission ADMIN。保護回避はしない |

今後の実装ではこのPRを継続する。別の古いcheckoutで同じ修正を作り直さない。main差分の取得・統合は通常のGit契約に従い、競合とユーザー変更を保持する。今回はfetchやbranch更新はしていない。

## 3．CIの事実と限界

確認run：https://github.com/jimuin0/carelink/actions/runs/35839816462

対象SHA：`74feca59cf5b46e7db59faf1250f17bc2af59e0d`

| 検証 | 確認結果 | これだけでは証明しないこと |
|---|---|---|
| Lint & Type Check | SUCCESS | 最新main統合後の成功 |
| Unit Tests + Coverage | SUCCESS | 全顧客入力・全障害経路の網羅 |
| Security Audit | SUCCESS | 認可・店舗越境などアプリ仕様の完全性 |
| Contract Testsジョブ | SUCCESS | hosted staging・本番schemaの現在一致 |
| 隔離local Supabase API Contract | 2 suites／15 tests成功、no-skips gate成功 | hosted stagingや本番のmigration適用 |
| E2E | 269 passed、6 skipped | 必須検証がすべて実行済みであること |
| E2E内production build | SUCCESS | 本番へそのSHAがdeploy済みであること |
| Vercel commit status | SUCCESS | 本番SHA・対象機能・メール到達の照合 |

branch protectionはstrict up-to-dateを要求する。必須contextsはLint & Type Check、Security Audit、Unit Tests + Coverage。ユーザーの受入条件はこれより広く、Contract、build、対象E2E、必要なセキュリティ・本番確認も満たす必要がある。

6 skipsに対応する静的設定は、Mobile Safariのfirst-paint 4件と、ローカルHTTP環境では実行しないHTTPS 2ブラウザ分。設定理由を読んだだけで免除承認とはしない。first-paintは対象ブラウザでも安定して検証する方法を整えるか、同じ不変条件を保証する証拠を適用規則に従い用意する。本番HTTPSは別のread-only検証で実際のHTTP→HTTPS遷移を確認する。未実行を成功へ書き換えない。

外部staging検査は環境変数未設定時にskipされ得る。別ジョブの実local API Contract成功と区別し、hosted staging必須要件の充足は別途確認する。

## 4．不足しているものの分類

| ID | 不足／問題 | 今回の処置・状態 | 次に実行すること | 神原さんの操作が必要になる条件 |
|---|---|---|---|---|
| PRE-01 | 規則参照先が不明とされていた | 解消。r39全hash一致 | 同じ参照元を再開時に使う | 不要 |
| PRE-02 | 古いcheckoutと修正PRが混在 | 解消。再開先とSHAを特定 | PR #642の作業branchを継続 | 不要 |
| PRE-03 | Git操作能力・ローカル検証能力が不明 | gh権限、Node/npm、Docker応答、Supabase CLI、gitleaks存在を確認 | repository lifecycleの事前確認後、隔離local DBで実検証 | 通常不要。CLIの存在を本番認証済みとは扱わない |
| WORK-01 | 古い台帳から現在の未修正を数えられない | 430 IDラベルは430確定バグではない。旧台帳は元checkoutが基準 | PR候補・最新mainへIDごとに再判定し、変更・テスト・残件へ対応 | 不要。全台帳完了まで受付障害修正を待たせない |
| WORK-02 | 登録→受付→引継ぎ→公開→複数店舗が未接続 | 一部修正済みと残件を分離した | 第5節のまとまりで実装と異常系テスト | 所有者数・公開要件を変える必要がある場合のみ方針判断 |
| WORK-03 | PRが最新mainより古い | behind 7確認 | 安全に最新main統合→最新SHAの必須CI再実行 | 不要。admin bypass禁止 |
| VERIFY-01 | skip・過度なmock・本番未確認 | 数値と限界を区分 | 対象E2E、API/DB Contract、権限・競合・再実行、独立レビュー | 独立レビューが保護された人間承認を要求する場合だけ |
| PROD-01 | 本番schemaとmigration履歴の完全な照合なし | 過去の一部true結果だけでは全migrationを証明できない | 列・RPC・権限・制約・履歴・適用順をread-only照合。必要な適用は安全計画後 | 認証、費用、重要書込みの承認など実際に必要な場合のみ |
| PROD-02 | Auth/SMTP/Google・メール受信・実schedulerの証拠不足 | 未確認 | 第7節の認証・配信・Cron確認 | 本人ログイン、受信箱確認、明示的な外部本送信承認など |
| ACCESS-01 | ブラウザによる本番管理画面の読取 | 新規Supabaseタブのattach timeout、既存Renderタブのtimeout。未ログインとは未判定 | Supabase画面を開く要求はqueued。表示・接続復旧後に再確認 | ブラウザ接続復旧に本人操作が必要と確認できた場合だけ。今はパスワードを求めない |

ACCESS-01、PROD-01/02は本番の完了判定を妨げるが、ローカル修正、隔離テスト、台帳照合、PR準備は妨げない。

## 5．登録障害で先に実装する単位

既存設計：`/tmp/carelink-audit-20260924.8xy8L8/carelink-registration-resolution-design-20260926.md`。この設計の現状欄は元checkout基準なので、PR HEADへ再判定してから採用する。旧証拠は上書きしない。

| 単位 | 現在の証拠 | 必要な修正・確認 | 合格証拠 |
|---|---|---|---|
| 入力エラー | `/api/salons`は項目別Zodエラーを一律文言にする。顧客の実際の不正項目は未特定 | UI/APIのschema整合、項目別エラー、入力保持、DB Contract | 詳細入力の正常系、各境界値、400の項目フォーカス、PIIを出さない診断 |
| 応答消失・安全な再送 | PRの`readSalonRegistrationResult`は壊れた200・5xx等をunknownとする。再送禁止はページ内state/refであり永続受付照会ではない | 安定した申込キー、同一intentの冪等受付、安全な成否照会 | commit直後の応答消失、reload、二重クリック、並列送信でも1受付 |
| 完了表示 | `register/complete/page.tsx:22`は無条件完了。`register-complete.ts:16,25`はid不正・未発見で空summary | 受理確認と未確認・不存在・読取失敗を分離、受付番号と再開導線 | idなし、不正、未発見、DB障害で完了誤表示なし。照会情報の権限保証 |
| 写真 | PRの`settleSalonUploads`は全uploadの終了を待つ。unknown時の写真保持も改善済み | この修正を保全し、永続受付・cleanup状態と統合 | 遅延upload、途中失敗、保存済み応答消失で参照中画像を消さない |
| 店舗への引継ぎ | `facility/setup/route.ts`は同メール未claim候補を集め`mergeSalonRows`で統合する | 申込IDと店舗IDを対応、本人確認と店舗同一性を分離、原子的claim | 同メール5店舗でも住所・写真・説明・所有者が混ざらない。並列claim防止 |
| 管理・公開・検索 | 受付、draft作成、公開は別工程。既存の複数店舗対応と選択経路は再判定が必要 | 店舗context統一、公開不足理由、地域正規化、受付検索・pagination | 5店舗の操作が混線しない。公開済み店舗が正しい県・市・店名で見つかる |
| 実問い合わせ | 西尾本店の受信有無・2店舗案件との同一性は未確認 | 許可された最小読取で個別に照合。結果不明の盲目的再送や同メール自動統合はしない | 受信、重複、引継ぎ、公開状態を店舗別に説明できる |

上表は最優先の実装単位であり、セッション全体の未修正の全件数ではない。最初の受付障害を解決しても、他の対象内残件を消したことにはしない。

## 6．他の既知指摘を落とさない手順

既存索引：`/tmp/carelink-audit-20260924.8xy8L8/carelink-known-findings-index-20260926.json`。151文書由来の430 IDラベル・IDなし候補があり、重複・旧版・誤検知を含む。

各IDに次を付ける。

- 原依頼／原票、旧対象SHA、現在の候補SHA。
- 同一根本原因の統合先と、別経路の内訳。
- 現在判定：確認済み未修正／コード上修正済み／本番要確認／誤検知／重複／未判定／明示保留。
- 到達経路、caller、guard、DB制約、testによる反証。
- 実装commit、回帰test、最新SHAのCI、必要な本番確認。

認証、予約リマインド、Cron heartbeat、webhook、NPS、バックアップ、メール返信などは既にPR内修正がある。旧根拠だけで再実装しない。変更された経路と修正のない残経路を別判定にする。

保留：決済・Stripe・キャンセル待ち、GoogleカレンダーのJSTずれ、LINE解除後の通知対象問題。明示的な保留解除がない限り変更しない。保留は解消扱いにせず、全完了報告の対象外として残す。

監査20巡は今回完了していない。既存記録の有効完了巡数0/20を水増ししない。実装テスト回数を監査巡数へ読み替えない。

## 7．本番確認に必要な具体的証拠

| 領域 | 必要な証拠 | 注意 |
|---|---|---|
| DB | migration一覧と履歴、列型・default・制約・RPC署名・実行権限・RLSの一致 | `pending_booking_reminders`と`sent_reminders.delivery_state`の過去6項目trueだけで、登録source・Storage等の全適用を推定しない |
| Auth確認メール | Auth provider有効性、確認設定、SMTP sender、制限、秘匿化した送信結果、確認リンク後のsessionと元申込復帰 | Resendの受付メール成功とSupabase Authメール成功は別 |
| Google | providerとredirect allowlistの整合、callback成功、失敗後の再開、profile生成 | 過去522はprovider前段の障害候補。今日の成功で当時の原因を確定しない |
| 外部障害 | timeout／522時に成否不明を成功や空データへ変換しない、重複送信なし、復旧後照会 | providerの将来無障害は保証しない |
| Cron | 実scheduler、認証設定、直近実行の業務結果、heartbeat、失敗通知、復旧判定 | HTTP200、skipped、処理0件、送信成功、記録失敗を混同しない。重複通知防止も確認 |
| deploy | merge commit、providerのdeploy済みSHA、health、変更対象のread-only確認と許可された実機test | Preview statusだけでは本番確認にならない |
| 実案件 | 対象店舗ごとの受信・重複・紐付け・公開・無料条件 | 問い合わせ文は自動登録・顧客返信の無条件許可ではない。実送信は別の固定計画 |

DB適用、本番データ変更、実送信は効果ベースの承認・capability・復旧条件を満たしてから行う。秘密値を読取結果や成果物へ載せない。

## 8．再開順序と完了判定

1. 本書のcheckout・PR HEADと実際の状態を再照合し、利用者の変更を保持する。
2. 最新mainとの差分を取得・確認し、既存PRへ安全に統合する。保留範囲を改変しない。
3. 登録関連REG-01〜20を候補SHAで再判定し、最初の受付修正を実装する。全体台帳の未整理をこの着手の人為的な待ち条件にしない。
4. 単位ごとに正常・不正入力・権限・競合・再実行・途中失敗・成否不明を隔離環境で検証し、既存修正を回帰させない。
5. 他の対象内指摘を第6節の台帳で閉じる。未知を0扱いにせず、保留と重複を分離する。
6. 固定snapshotへの必要な独立レビュー、lint、型、単体・coverage、適用するmutation/property、Contract、production build、E2E、securityを完了する。
7. 第7節の本番前提を並行して確認する。アクセス不足があれば該当工程だけ分離する。データ影響を伴うmigrationは安全計画と承認条件を満たす。
8. 対象ファイルだけcommit・pushし、既存PRを更新。最新SHAで必須CIを満たし、strict保護・必要なクールダウンを守ってmergeする。CIのskipや古いSHAで代替しない。
9. merge後deploy済みSHA、health、主要変更動作、DB実体と履歴、Cron業務結果を照合する。

実装GOALの完了条件は、保留を除く対象内の既知未解決P0〜P3・blocking unknownが0、原依頼から実装／検証／本番証拠への対応が完了していること。未知の不具合が絶対に存在しない保証ではない。

## 9．神原さんに必要なこと

今すぐ追加のGOやruleset配置は不要。通常の技術作業はAI担当。

本人操作が必要になるのは、実際の認証画面で本人確認が必要な場合、権限を変える場合、必要な受信確認、具体的な重要書込み・本送信承認、経営方針を変更する場合に限る。複数店舗owner制約や掲載のみの公開条件の変更は、現行仕様で満たせない範囲を具体化してから尋ねる。事前に全工程を止める質問にしない。

ブラウザの現状は接続timeoutであり認証切れとは未判定。Supabaseホームをサイドパネルへ開く要求はqueuedと返った。表示された／ログインが必要／本番操作できたとは報告しない。この接続問題はローカル修正開始の条件ではない。

今回は本書の前提整理を完了したもので、アプリ全修正・20巡監査・merge・本番反映を完了したものではない。

## 10．実装再開契約（次の依頼による更新）

2026年9月26日、神原さんからAstraで設計を確認しながら全修正・一気通貫テストを進めるGOALを受領。本節以降は実装あり。第1〜9節は前提確認時点の履歴として保持する。

GOAL ID：CARELINK-REMEDIATION-20260926、revision 1。実装ownerは親AI。認可・データ整合等の変更は固定snapshotをAstra独立担当がレビューする。規則は第2節のr39へ固定。認証済み原依頼のmessage IDは環境に公開されていないため捏造しない。

| 受入ID | 原依頼／制約 | 成果物・必須証拠 | 状態 |
|---|---|---|---|
| AC-01 | 設計図を確認し全修正 | 第5〜7節と原票を現行候補へ再判定した台帳、対象内修正、未解決0 | 未完了 |
| AC-02 | 一気通貫テスト | 入力→受付→認証→正しい店舗→管理・公開→通知・復旧。正常／異常／境界／権限／競合／再実行テスト | 未完了 |
| AC-03 | 最新SHAの緑 | lint、型、unit＋coverage、Contract、build、対象E2E、security、必要な独立レビュー。未実行・skip・旧SHA不可 | 未完了 |
| AC-04 | 本番反映と確認 | 保護merge、deploy SHA／health／変更機能、DB実体とmigration履歴の照合 | 未完了 |
| AC-05 | 神原さんだけの判断を代行しない | 費用・不可逆操作・本人認証・経営変更を分離。安全な代替は実在候補を各一度 | 継続条件 |
| AC-06 | 既存の保留・変更保全 | 決済・Stripe・キャンセル待ち・GoogleカレンダーJST・LINE解除は保留。利用者差分を破棄しない | 継続条件 |

品質適用：事業価値＝申込と管理の完走、正確性＝状態・DB一致、UX/a11y＝項目エラーと復帰、security/privacy＝受付権限・店舗分離・PII非露出、信頼性＝競合・再試行・成否不明、運用＝監視と復旧、保守＝共通schemaとテスト、費用・法務＝無料条件と既存公開要件維持。すべて本GOALに適用し、必須証拠未充足なら完了しない。サービス全体の品質level再認定は依頼対象でなく、変更単位gateを実施する。

次の機能単位W1A：受付完了表示と入力エラーの修正。対象はsalons APIのvalidation、共通schema、register UI、完了ページ／lookup、直接関連テスト。永続冪等受付・DB原子化は後続W1B/W2へ残し、W1Aだけで全受付問題を解決済みとしない。

W1A設計：UI/APIで制約を共有し、400のfield errorは固定された項目にだけ返す。全入力を保持し該当stepへ戻る。完了lookupはconfirmed／not_found／unavailable／unverifiedを区分し、署名claimが確認できないidから申込情報を公開しない。正常時は受付番号を表示し、DB障害や未確認時は完了・新規再送へ誘導しない。既存の成否不明時写真保全・bot対策・CSRF・rate limitを維持する。

準備判定：対象・依存・現コード・検証方法は確認済み。Astra独立設計照合とネットワーク遮断環境のbaseline75件成功を受け、W1A実装へ進んだ。外部送信・本番DB変更はこの準備PASSに含めない。設計照合で指摘された写真stateの保持、details展開後のfocus、recruit呼出元のschema整合、実受付画面のE2E assertionを追加した。

再開記録：origin/mainのa07be592をfetchし、既存branchへno-commit merge。競合0、merge commit未作成。元のtracked変更なし、既存未追跡は本書1件のみ。取得した7コミットを破棄・再実装せず統合する。

### 10.1．原依頼固定

sourceは現在taskの認証済みuser message。message IDは非公開。canonical化v1は下記sourceブロック内部をUTF-8・LF・先頭末尾空白除去・末尾LF1つとする。GOAL契約本文は第10節見出しから本小節直前までを同じ規則でcanonical化する。hashは進捗記録へ置き、本文自身へ自己参照させない。

<!-- SOURCE-BEGIN -->
GOAL：Astraで設計図を確認しながらコードの全修正を進め、プロジェクトの一気通貫させること。一気通貫させるテストなども含め行うこと。


神原のすること
実績や画像・事実内容の提供以外必須、認証が必須、神原でないといけない入力の部分、経営方針

あなたのすること
「神原のすること」を除き、着手前に、このタスクのGOAL、受入条件、対象範囲、対象外、必須検証、完了条件を現在の依頼と権威ある規則から整理し、成果物・変更・検証結果まで追跡可能にしてください。事業判断が必要な部分を除き、技術上の不明点は安全な根拠のある案を採用してください。

「緑」は、最新の変更SHAに対する全必須チェック成功を意味します。必須チェックの未実行・skip・古いSHAの結果は合格とみなしません。重大度と影響に応じ独立レビューを行い、対象範囲の未解決指摘とblocking unknownがないことを確認してください。

本番反映が対象に含まれる場合、merge後にdeploy済みSHA、health、および変更対象の実動作を確認してください。migrationがある場合はDB実体とmigration履歴の両方を照合してください。

接続・認証・承認などで止まった場合は、実在する安全な代替経路を各一度試し、解決しなければ未完了のnode、試した経路と結果、再開に必要な人の操作を一度に示してください。無関係な代替策を延々と試したり、必須チェックや保護ルールを回避したりしないでください。

もしおれの手が必要で全部のエラーがなくなるように進められないのであれば、改善できる画面のところまでサイドバーのブラウザで開いて。
<!-- SOURCE-END -->

### 10.2．W1Aの実装・検証追跡

固定hash（canonical化v1）：原依頼 `87f6aa84a733f1db4e10ea769eac21f7786b05d51fc7f1aa20096d22a55d03fd`、GOAL契約 `2ef9b5e8747aabd5a5d21e09ff2e6c1e3e0842037dcb3c8abe78ec79c1fed80e`。W1A関連10suite・213testはネットワーク遮断下で成功、skip0。型検査も成功。全体coverageとCI、本番確認はこれと別で未完了。

| 原票／直接発見 | 現在の対応 | 必須検証・残り |
|---|---|---|
| 入力内容が不正で受付できない、項目が不明 | validations.tsのUI/API制約共通化、固定メッセージのfieldErrors、該当step/details/focusへ復帰 | API・schema・UI回帰。原因が未適用DBの場合はW0の実体照合が別途必要 |
| 完了確認ができない、架空idでも完了表示 | 署名claimとDB行の一致時だけconfirmed。unverified/not_found/unavailableを成功にしない。受付番号を表示 | 実署名単体、page異常系、CIローカルDBで実cookie→完了表示E2E |
| 独立指摘・前step復帰で写真が消える | step3を非表示で保持し、選択済みfileとpreviewを維持 | 実MultiPhotoUploadで400→修正→削除・追加→再送 |
| 直接発見・複数写真の非同期読取競合 | slot世代と最新file参照で遅延読取の上書きを防止、読取失敗を表示 | 変更前3件RED、変更後同3件成功 |
| 独立指摘・recruitの表示業種7件がAPIと不一致 | 正規businessTypesを共有。勝手な別業種変換なし、「その他」は利用者が選び紹介欄で説明 | 全選択肢送信値のAPI schema検査。介護分類・ピラティスのSEO不一致は別残件で未解決 |
| 直接発見・recruitがHTTP成功だけで受付成功、通信断で盲目再送 | registerと同じ成功body検証・成否不明停止・二重click防止・受付番号表示 | malformed/invalid-id/missing-id/network/business-failure、再送抑止 |

既存実装の成功を前提にせず、変更前に受付表示／field errorの追加6件が失敗することを確認。unit実行はenvを空にし合成値だけを注入、macOS sandbox-execで全networkを拒否。元checkout内に実.envがないことも確認した。本番接続・実メール・実顧客登録はこの検証に含まれない。

W1Aだけでは永続冪等受付、DB原子化、複数店舗、掲載と予約要件分離、既存申込の受信照合・統合、Auth/SMTP/OAuth、Cron・監視、残存台帳の全解消は未完了。merge/deploy/本番確認も未実施。個別テスト成功をGOAL全体の完了と扱わない。

W1A追加記録：独立Astra監査で写真の不正な選び直し後に旧fileが残るP2、全角電話をformatPhoneで消してしまうP2、写真URL拒否が項目へ戻らないP3を発見。世代無効化＋file/preview解除、normalizePhone前処理、固定fieldErrorsを修正し、関連4suite・101test成功。再監査は20対象fileの開始／終了hash一致を確認し、この3件の解消と当該直接影響範囲の新規P0〜P3指摘0を報告した。全GOALの未修正0という判定ではない。

全体coverage診断は383suite中382成功、7761test中7754成功・7失敗。branches 8186/8186＝100%、lines 99.35%。失敗は全て既存register/page.test.tsxが非表示のPR欄を遷移完了と誤認する待機条件に起因。非表示stepを写真保持のため残す新実装に対し、可視textboxを待つよう修正し、同型のprefecture-cityと計10testを再実行して成功。失敗した全体runは緑と扱わず、修正後の全体再実行を開始。型検査と変更実装ESLintは修正後成功。集計証拠は `/tmp/carelink-w1a-coverage.7FUyaG/results.json`、再実行出力先は `/tmp/carelink-w1a-coverage-final-20260926`。

実DB検証の隔離準備：既存 `supabase_db_carelink` は共有所有者未確認のためreset／停止しない。専用一時root `/tmp/carelink-w1a-local.1vA9I2`、project `carelink_w1a_1va9i2`、port 56521/56522/56524、Docker internal network `supabase_network_carelink_w1a_1va9i2` を作成。migrationだけをsnapshotコピーし、実.env・実secretはコピーしていない。SMTPはlocal mailpit、analytics/edge runtimeを無効化。startの秘密値出力を親processで抑制する。起動、network実体、schema、Contract、E2Eの成功は準備完了とは別に確認する。cleanupはこのtaskが作成したresourceだけに限定し、共有DBへ波及させない。

ローカル実DB起動結果：専用DBが起動中に再起動を繰り返し、CLIはexit 1。終了後に専用containerとvolumeが残っていないことを確認した。Macの空き容量は確認時約174MB・使用率100%。容量不足と高負荷は環境上の障害だが、DB再起動の唯一の原因とまでは断定しない。全体coverage再実行もENOSPCで288suiteの読込みに失敗、95suite・2619test成功の部分結果に留まった。全体成功とは認定しない。作業用checkoutの再生成可能な `.next/cache/webpack` だけを削除し、空き容量736MiBを確認。ソース、未commit変更、共有DB、他taskのcacheは変更していない。重い再起動を盲目的に繰り返さず、代替は既存PRのGitHub隔離CIでfresh-apply／Contract／build／E2Eを行う。ローカル実DB検証は未成功。

Security依存検査：空の専用npm設定とcacheを用い、実認証値を注入せず公開registryに対して `npm audit --audit-level=high --ignore-scripts` を実行しexit 0・vulnerabilities 0。依存ファイル変更なし。E2E追加の独立レビューは、任意のlocalhost既存サーバーが本番DBへ接続し得るP2を指摘した。実書込みsuiteを、local DBでbuildし新規appを起動する既存GitHub CI lifecycleに限定する事前ガードを追加。4種類の希望時期と任意詳細全項目の実DB保存値照合、署名Cookie経由の完了表示を検査する。写真upload、本番captcha、hosted staging、本番をこのE2Eの成功範囲へ含めない。複数browser／retryは別々の合成client IPを使い、保存の正常系が同一bucketで干渉しないようにする。rate limit本体や拒否テストは無効化しない。

W1Aのcheckpoint：`e38538e175f1d3927caba6b112af2498ec77a00b` を既存PR #642へ通常push。merge/deployは未実施。最新追加後の型検査、変更E2E/configのESLint、actionlint、stage scan、push hookの189commit secret scanは成功。独立E2E再レビューは追加指摘0。ただし必須CIと本番の未完了状態を維持する。

### 10.3．次の局所修正W3Aの準備

REG-12のうち郵便番号非同期競合・住所手修正の古い隠しregionを修正する。遅い旧lookup、入力中の郵便番号短縮、住所の手修正、unmount後の応答はフォームを上書きしない。手修正時は隠しprefecture/cityを無効化して現行住所から既存parserで再取得する。lookup応答は型・HTTP結果を確認し、不正応答や外部障害時にも手入力を保持する。既存の都市master・全地域key統一は別nodeであり、今回parserの仕様を変更して達成済みにしない。

準備根拠：RegisterFormのuseEffectは全lookup結果を無条件setValueしており、住所編集はprefecture/cityを更新しない。APIは非空の明示regionを優先するため、古い地域が保存される到達経路を親が再確認。局所設計は世代による無効化と入力時のregion解除。ネットワーク遮断したdeferred fetchで順序逆転・短縮・手修正・不正応答を再現し、修正前RED→修正後成功、既存3件と写真・送信回帰を実施する。追加DB/migration・本番操作・経営仕様変更なし。

W3A実行証拠：修正前は追加後10test中6件失敗（旧応答上書き、短縮後上書き、手修正上書き、空住所の旧region、HTTP失敗／型不正応答）。修正後、写真・送信・ratchetを含む4suite37test成功。network拒否／JSON解析失敗を追加した2suite25testも成功。RHFのregister引数にrefを使うhandlerを渡すと新たなCompiler警告が出るため、DOMのonChangeイベント内でRHFのhandlerとregion解除を呼ぶ形へ修正。effect cleanupはclosureのcancelledを設定する。最新フォーム12test、変更3fileのESLint、型検査が成功。独立再レビューはP0〜P3追加指摘0で、インストール済みRHFの同期値更新まで直接確認。unmount無効化は静的確認で、実機のunmount試験済みとは扱わない。地域parserの粒度・地域master統一は未完了。

CI `36217561970`（e38538e1）は383suite7761test成功、branches8186/8186＝100%、lines99.35%、Security/Contract job成功、schema-fingerprint成功。ただしLint内の厳格な負債件数gateが6→4件への改善を検出して失敗し、依存E2Eは未実行。baselineを実測4へ下げる修正を追加した。検査対象縮小・無効化はしていない。Contract job成功とhosted staging実証を同一視しない。

本番接続の現在地：既存in-app-browserの取得は「Browser is not available: iab」、接続browser一覧は0件。Supabase専用connectorも利用可能toolsにない。サイドバーへ当該projectを開く要求はqueuedだが、画面表示・ログイン状態は未確認。これを未認証と断定しない。本番操作は実行せず、local/CIで安全にできるnodeを継続する。

### 10.4．W1Bの実装準備案（未実装・未本番適用）

独立Astraの設計照合を受け、受付正本salonsを維持し、PIIを複製しない小さなintent台帳を追加する案とする。最初の準備APIでserver生成UUIDと十分なentropyのproofを発行し、proofはintent別HttpOnly cookieだけへ置く。sessionStorageはintent IDと進捗だけに限定する。複数tab・複数店舗のcookie上書きを防ぐ。準備応答不明でproofを取得できなければ申込POSTへ進まない。

payload比較はproofから用途分離した鍵でHMACし、canonical versionとschemeを記録する。電話・メールのplain hashは禁止。比較値／proof／payloadをログ・receiptへ出さない。RPCはservice role専用、intentをFOR UPDATEし、同内容の再送は既存receipt、違う内容は409、未確定ならsalons INSERT・intent commit・outbox INSERTを同一transactionで行う。anon/authenticated/PUBLICのEXECUTE拒否を実DB検証する。旧v1と新v2は明示判定し、無効なv2をv1新規INSERTへfallbackしない。

写真はintent別のslot manifestと既存object参照を保持して再送で再利用する。commit済みの可能性があるobjectを400等のstatusだけで削除しない。未参照・期限切れ・intent lockを確認したcleanupのみとする。通知queueは受付ID＋種別＋template versionを参照し、業務transaction内で一意登録する。既存enqueueWebhookは失敗を捕捉して返すため原子outbox用途には使わない。workerは成否不明を自動再送せず照合待ちへ置く。worker対応→v2受付有効化の順とし、直接送信とqueueを二重実行しない。

v2の店舗引継ぎは選択したintentの権限確認済み申込だけを使い、同メール全申込mergeを使わない。W2の原子的claimと接続するまではv2を利用者へ有効化しない。既存1user1owner方針は変更しない。必須証拠はfresh/upgrade migration、schema/type/RPC ACL、20並列同intentで1受付1論理通知、応答消失→reload照会、別payload409、5tab別intent、他者proof拒否、写真参照保全、outbox失敗時全体rollback、worker成否不明の自動再送0。既存W1Aの成功をこの証拠の代用にしない。

### 10.5．W1B foundationとHTTPS E2Eの検証中記録

W3Aを `5842d918a5c286994c764fbdec49df12f05b85ef` として同じPRへpush。CI `36218949470` のlint／型／unit coverage／security／Contract job／local DB fresh apply／local API contract／production buildは成功したが、E2Eは271成功・4失敗・6skipで未合格。失敗4件はMobile Safariの登録完了確認である。合成CI traceを確認し、HTTPの申込応答にSecure claim Set-Cookieがあり、続く完了画面要求にはclaim Cookieがないことを確認した。本番CookieのSecureを外す対処はせず、CIだけlocalhost HTTPSを使用する。秘密鍵は一時process memoryとOpenSSL stdinだけに置き、file保存・値出力・外部CA接続をしない。ネットワーク遮断下で証明書と鍵の一致・localhost SANを実検証した。実ブラウザー完走は次CI待ちである。

W1B foundationとして、canonical化25項目、version固定、ランダムproofのdigest、用途分離HKDF/HMAC、intent台帳、同一transactionの受付／commit／参照型outbox RPC、型定義と列snapshotを追加した。実行API・worker・写真復旧・W2 claimへは未接続であり、利用者向けv2を有効化していない。stateは独立した文字列ではなく、DB CHECKで全NULL／全NOT NULLを強制するcommit列の組合せから導出する。

静的独立レビューはfoundation、role ACL、保護列、queue CHECK、HTTPS lifecycle、実Cookie属性検証を照合し、確定P0〜P3指摘0。ただしSQL・HTTPS実行済みとは判定していない。SQL fixtureにはanon/authenticated拒否、wrong proof、expiry、replay/conflict、保護列、registerとrecruitの通知差分、2件目outbox書込み失敗の全rollbackを含めた。並列fixtureは調整transactionでintent行をlockし、20clientの実Lock待機を観測してから解放する。単に20process起動しただけで競合試験成功とは扱わない。

ネットワーク遮断下のcanonical／proof／DB fixture接続拒否テスト33件とHTTPS起動拒否テスト8件が成功。拒否guardのテストは、ガードを通過した後の依存tool欠如エラーと区別し、下流エラーを拒否成功と誤認しない。新migrationの実SQL、20並列、upgrade、fingerprint生成と一致、最新CI、staging／本番schemaと履歴は未検証である。fingerprint期待値は手編集せず、既存の使い捨てPostgres17生成artifactから更新する。それまでschema gate失敗を保持し、mergeしない。

### 10.6．W1B outbox workerとclaim所有権の修正

checkpoint `c5ee1b02cb5925f5c9a09dd57bf5e53229478c91` のCIではUnit／coverage、Lint／型、Security、Contract job、production buildが成功。E2EはHTTPS serverの起動段階で失敗し、browser検証は未実行。LinuxのNode child stdinとOpenSSLの再openの互換性を疑い、秘密鍵を保存せず固定shellの実pipeで渡す形へ変更した。生errorは出さず固定phaseだけを表示する。Linuxの隔離再現はDockerのcontainer作成前I/Oエラーで実行できていないため、真因確定・TLS成功とは報告しない。

schema run `36220861589` は全migration適用後、旧期待値との差分で失敗した。runとHEAD一致を照合した生成artifact `10899357553` の期待JSONを取り込み、SHA-256 `e58d8c1d6b70696ed0e278551189be22c3e1eca6ae023a3194a47dee0d14512f` がartifactと一致。差分は新intent／RPC／queue関連30行追加だけ。手編集なし。SQL role／rollback／20並列fixtureは前段失敗で未実行のため、次CIで必須確認する。

参照型outboxのworker接続を追加。宛先・本文はserver側で該当receiptから構築し、Slackには申込個人情報を載せない。送信設定・種別・参照整合を送信前に検証し、送信開始を記録してから送る。結果不明は照合待ちで自動再送しない。v2受付APIは引き続き未有効化。

親の再現でmarker更新0／nullでも旧実装が200を返す2件のREDを確認。marker、success、retryをclaim時刻とprocessing状態のCASにし、返却1行の確認を必須化した。独立レビューで初回claimのpending復帰ABAも発見。予定時刻の再確認と、UPDATE返却の最新payload／attempt使用へ修正。修正前の追加2件RED、修正後4suite132test成功。対象3実装のbranches140/140、lines189/189、functions13/13。旧worker復帰、0行更新、未来再予約、最新試行回数、送信成否不明を含む。検証は空env・外部network遮断・合成データのみ。

独立再レビューはCAS／ABAの解消を確認し、SQL ACL試験が内部table拒否をEXECUTE拒否と誤認し得る点を指摘。fixtureにanon／authenticatedのEXECUTEなし、service_roleのEXECUTEありの直接assertを追加した。実SQLの成功は次CIで確認する。本番DDL・実送信・merge・deployはこのcheckpointで実施していない。

上記修正後の型検査と対象ESLintは成功。実pipe方式の証明書はMacのnetwork遮断下で鍵一致・localhost SAN一致を確認した（Linux／WebKit成功とは別）。SQL ACL修正の独立再レビューは追加指摘0、対象hash `abd7842126c97c3bb6cf0d0e756a35396641e99cad42d44289cbd9999a2cb888` 一致。次は同PRでCIの実SQL・競合・ブラウザー検証を再実行する。

### 10.7．da0 checkpoint結果と準備／状態照会API

`da0e6bb61a5c23f631110b87a9d139ac32ef32d4` のCI `36222727595` はUnit＋Coverage、Lint／型、Security、Contract jobが成功。E2Eは276成功・1失敗・4skipで未合格。以前失敗した施設登録のSecure Cookieによる受付確認は成功した。schema run `36222727651` は全migration、fingerprint、リマインドfixture、受付のrole／rollback fixture、20並列競合、function body fingerprint照合の必須stepが全て成功。これらは使い捨てCI DBでの証拠であり、本番適用証拠ではない。

残るE2E失敗はMobile Safariの顧客signup後遷移。合成CI traceの限定projectionで、HTTPS画面からHTTP localhost Supabaseへの通信がmixed contentで拒否され、signupのnetwork requestが発生しないことを確認。ブラウザーの制限やCookieを弱めず、CI専用TLS dependency proxyでbuild／SSR／browser／seedのSupabase originを統一する。秘密鍵はメモリのみ、Node trustに使う公開証明書だけを専用tempへ保存し終了時に削除する。upstreamは127.0.0.1:54321固定。build/testは非同期spawnでproxyを止めない。独立レビューのWebSocket例外／cleanup指摘を修正し、process group終了も有限化する。実Linux／WebKitは変更後CIで再検証する。

準備APIと状態照会APIを追加したが、`SALON_REGISTRATION_V2_ENABLED=true` のときだけ利用可能で、既存環境では有効化していない。proofはintent別HttpOnly Cookieのみ、JSON・URLへ出さない。準備にはPIIを受け付けず、状態照会はID＋proof digestの一致とserver側3日期限を確認し、receipt以外の申込内容を返さない。prepare期限は1日、response-loss照会期限は3日。未知ID／wrong proofを同じunverifiedとし、DB失敗を成功扱いしない。追加53testと型／対象lintは成功、独立レビュー追加指摘0。SQL RPC側の3日期限制約、commit API、写真manifest、W2の原子的claimは未接続のため、v2を有効化しない。

現時点でmerge、deploy、本番migration、実送信は未実施。既存設計の他wave、旧台帳再判定、本番実体／履歴照合は未完了である。API局所成功やCI局所成功を全修正完了と読み替えない。

`f58ef3a97fd64a66dfe74654f33269bcd4ece7d7` をpushし、CI `36225042704` はLint／型、Security、Contract jobが成功、schema run `36225042696` とActionlintも成功した。Unitは7930成功・2失敗で、失敗は新APIのidentity gate認識と新環境変数の文書漏れ。E2Eは依存失敗で未実行。prepareはアカウント作成前の匿名開始という根拠を既存の理由必須台帳へ追加し、状態照会はID＋proof＋server期限をDB検証するhelper呼出しを認識させる。proof形式チェックだけ／コメントだけでは認識しない負の対照も追加した。環境変数表へdefault offとrelease gateを追記。修正後の関連74testは成功。検査を削除・skipしていない。

### 10.8．W2 UIの異常復帰準備

店舗オンボーディングの現行コードは認証／所属照会／POSTのrejectを捕捉せず、処理中の表示が残る。POSTはHTTP statusやfacilityIdを確認せずtruthyなsuccessだけで遷移する。また所属のmaybeSingleは複数所属でエラーになる。局所修正は所属存在確認を上限1行にし、認証・照会例外は再照会導線、POST結果不明は自動再送せず再読込みで既存所属を確認する。成功判定はHTTP成功・success厳密true・UUID形式facilityIdをAND条件とする。未認証、照会失敗、JSON破損、200不正body、HTTP失敗＋success、送信拒否、二重clickを合成テストで確認する。これはW2 transaction／同メール混合廃止の代替ではなく、APIの原子性は別途未完了として維持する。

W2 UI実行証拠：変更前に追加12件の失敗を確認した。認証・所属照会の例外復帰、厳密な成功応答検証、同tickの二重送信抑止、結果不明時の非再送を実装。独立レビューでPOST待機中のunmount後に遷移するP2を確認し、追加テストREDからmounted確認と待機abortへ修正。30秒timeoutを設け、29,999msでは処理中、30,000msで結果確認案内となる合成試験を含め26test成功。実SDKのAuthSessionMissingErrorと通信障害を区別し、前者だけログインへ進む。全て空env・network遮断下であり、実DB原子性の証拠ではない。最新の型検査と4変更fileのESLintは成功。独立再レビューはこのUI範囲の追加指摘0。

`0c92a21ebf5ff3ab03c6571a7b3003bf047d1e9f` のCI `36225397185` は全job成功、schema run `36225397167` も成功。E2Eは277成功・4skipである。HTTPS dependency proxyにより以前のWebKit signup失敗は解消したが、skipを全必須検証成功に読み替えない。既存first-paint suiteのSafari除外4件を解除する。合成書込みは固定CI lifecycleだけに限定し、応答遅延の観測用にservice workerを遮断する。製品側の保護設定は変更しない。

独立レビューでfirst-paintの予約日時変更caseが「null＝成功」のため、取得未発火でも通るP2を発見。request発火、最初の描画存在、spinner、旧枠／空きなし非表示の全条件を要求し、固定時間待機を応答保留・finally解放へ置換した。再レビューは追加指摘0。これは初回日付選択の検証で、前日を実際に読み込んだ後の2回目選択の証拠とはしない。XSSテストもnavigation前からdialogを捕捉し、早期実行を取り逃さないよう修正した。HTTPSテストの名前を実際のassert範囲へ合わせ、HTTPならskipせず失敗させる。これら追加E2Eの実ブラウザー成功は変更後CIで確認する。直前SHAの成功は流用しない。

### 10.9．W1B受付RPCのcapability期限整合準備

既存prepare／statusのserver期限3日に対し、commit RPCはcommit済みintentのreplayを無期限に返す。Cookie期限は手動送信を防げないため、DBの行lock取得後・replay判定前にもcreated_atの未来値拒否と3日期限を設ける。1日prepare期限が過ぎても3日以内のcommit済み照会は維持し、期限後はreceiptを返さずunverifiedとする。既存migrationを書き換えず追加migrationで関数を置換し、ACL・既存登録原子性を維持する。使い捨てDB fixtureでcommit済み3日経過、未commitの長いprepare期限、未来created_atを拒否し、既存replay／conflict／rollback／20並列を再実行する。fingerprintの期待値は実DB生成物だけから更新する。本番適用・v2有効化はこのnodeに含めない。

追加migrationとfixtureを実装。独立比較は期限分岐以外の関数body／ACL差分なしを確認。単体・静的整合3suite52testと実行環境拒否を含む2suite15testがnetwork遮断下で成功した（重複3件を含むため合算をユニークtest数とはしない）。競合scriptは既存20client同receipt検証を保持し、別intentで20clientのLock待機を観測後、合成created_atを調整して実時間で期限を跨いでから解放し、全20件unverifiedを要求する。これによりtransaction開始時刻now()への誤変更を検知する設計。独立再レビューは追加指摘0、JS構文と対象TS lint成功。実SQL・期限跨ぎ競合は変更後CIが未実行であり、現時点では成功認定しない。

### 10.10．W1B写真manifestの準備

写真を申込intentへ紐付ける準備を分離して実装する。圧縮後のMIME・byte数・slot（0〜6）・client選択UUIDを固定し、server生成UUIDから不変object pathを作る。同じ選択UUIDは同じmetadataに限り同pathを返し、変更はconflict。選び直しは別UUIDとし、1intent最大28選択までで容量abuseを有限化する。これは7枚同時選択の制限を緩和しない。新prefixへの直接INSERT・UPDATE・DELETEは匿名／認証済みとも許可せず、署名uploadはupsert falseを必須にする。

独立設計確認により、既存の広い匿名INSERTは追加policyでなく置換する。現RegisterFormのsalons/ prefixは維持し、ログイン済みも同じ公開登録uploadに限って許可する。他bucketは変更しない。carelink-uploadsがfresh DBに無い場合は作成し、MIMEは既存4形式、サイズは最大10MiBへ制限する。既存のより厳しい容量制限は広げない。metadataは欠損・型不正・MIME不一致・サイズ不一致なら不合格であり、画像内容の真正性の証明とは扱わない。既存public設定を変更しない。

manifest作成RPCはintent lock内でproof／version／3日期限／prepare期限／未commitを検証し、service roleのみ実行可能。署名発行API、実Storage upload、commit時のmanifest／object存在照合、UIの選択世代と再利用、cleanupの同intent lock順序は後続必須node。原子commitの写真照合とW2が揃うまでv2は有効化しない。実DBのroles／replay／競合／上限、実Storageのサイズ・MIME・overwrite拒否・v1互換が必須で、SQL policyの文字列確認だけでは合格にしない。

前checkpoint `98e5a945efa516cc702f89816768a8fe4c01d2c4` のCI `36226566801` は全job成功。E2Eは281成功・skipなし、schema `36226566793` とActionlintも成功。これは新しいphoto migrationと期限lock修正の証拠には流用しない。

photo fixtureにrole／metadata境界／replay／上限／commit後拒否を追加。競合scriptは27件から20clientを同時に進め、1prepared・19limit・最終28件を要求する。Storage E2Eは管理されたCIの使い捨てHTTPS環境に限定し、合成identityのみ作成する。署名uploadの再使用・public roleの変更／削除・10MiB境界・MIME・旧upload互換を実サービスで確認する予定。StorageUnknownError、5xx、401、404、429は拒否成功に数えない。実E2EをVM内で変換し、安全guardと拒否分類を負対照検証した。関連3suite31testが外部通信遮断下で成功、独立レビューの追加指摘0。400／403等だけでは個別拒否理由まで証明できないため、実Storage結果を別gateに残す。

実DBからの型生成artifactをCIへ追加した。fingerprint期待値はCI DB生成物と照合して反映する。一方、既存Contractがdatabase.types.tsを本番introspectionの記録として扱うため、local生成型を本番適用証拠として置換して緑にしてはならない。型artifactは候補schemaの照合用であり、本番のschema／履歴／生成型の確認は別途必須である。今回のmigration・SQL fixture・Storage・競合の実行はまだ未完了。本番反映・新受付経路の有効化・merge・deployは行っていない。

`4bc048e8b07ae3716ae5d94c99e15543db3322e1` のschema run `36228213298` は新DB差分で失敗。225migrationを適用した実DB生成artifact `10901362047` を照合し、そのまま期待値へ反映した。SHA-256は `090f640c77a57ff24fedbf89494e03b7c4c614153931490c3458a751287f1c69`。後続fixtureは前段失敗で未実行。CI `36228213290` はUnitの型／snapshot同期1件、Contractの新table／RPC未記録2件で失敗し、E2Eも前提job失敗で未実行だった。E2Eの実行依存をlintのみに分離するが、UnitとContractの合格義務・保護merge gateは維持する。本番未適用の赤を隠さず、独立した使い捨てDB検証を進めるためである。

### 10.11．W2既存setupの読取失敗時停止

原子的claimへの移行とは別に、既存setupの所属照会／申込照会がエラーでも施設INSERTへ進む不具合を局所修正する。REG-08に対応。読取失敗を未登録とみなさず503を返し、profile／member／claim／photo／welcome／auditを開始しない。Cookie由来の照会に失敗した場合はメールfallbackへ進まない。正常な0件と読取失敗を区別する。DBの生エラーに個人情報が含まれる可能性があるため、当該通知は固定された失敗段階だけにする。元の入力・claim Cookieは失敗応答で消さない。既存1owner／メールmergeの正常経路はこの局所修正では変更しないが、後者の撤去と原子性は引き続き未完了である。合成DBエラー／null応答でREDを確認後、no-write・no-send・情報非露出を検証する。

5ケースで修正前200／期待503のREDを確認。修正後はさらに3照会のPromise rejectを捕捉し、生エラーを破棄して同じ固定503とした。network遮断下で89test成功、対象routeのbranches／lines／functionsは100%。型検査と対象lintも成功。独立再レビューは追加指摘0。これは読取障害時の保全だけの証拠であり、成功時writeの原子性を保証するものではない。

`2d5a8f8f34667c72701ea93bf50366f2834d1bc3` のschema run `36228529236` は全fixture成功。20client実lock待機で1receipt・2通知intent、期限跨ぎ20件拒否、27写真から20競合で最大28件を実SQLで確認。CI E2E `108367333872` はfresh Supabaseのmigration003でpolicy RENAMEに42501（storage.objectsのownerが必要）となり未実行。前段WITH CHECKは通過している。不要な名称変更のみ除去し、制約は保持する。権限昇格は行わない。修正後のfresh applyと実Storage検証は次CIで必須とする。

### 10.12．W1B写真の署名準備APIと実体照合準備

POSTのintent ID・選択UUID・slot・圧縮後MIME／byte数を厳密検証する。pathと署名tokenはclientから受け取らず、同intentのHttpOnly proofを検証するservice専用RPCの成功1行からのみ導く。DB成功でも返却pathがserver規則と不一致なら署名しない。Storage infoのbucket／name／size／contentTypeを台帳と照合し、既存objectが完全一致する時だけupload済みと返す。404に相当するobject不存在だけ署名準備へ進め、通信障害・5xx・不明な応答を不存在と扱わない。署名はupsert false固定。競合で既にobjectが存在した場合も上書きせず、同選択UUIDの照会へ戻す。署名／DBエラー本文は記録しない。APIは既存v2 flagで閉じ、CSRF／rate limit／no-storeを維持する。実Storageのinfo形状を使い捨てCIで確認してからAPI結合を認定する。選択上限・capability期限・commit後拒否はRPC側が正本である。

入力／path／metadata比較の純粋helperを追加。写真guard・build設定guardを含む3suite70testがnetwork遮断下で成功。SDKのinfo()はrecursiveToCamelを使うことを直接確認した。実Storage E2EにbucketId／name／size／contentTypeのassertを追加したが、実行成功は未確認。独立レビュー追加指摘0。API本体への接続はまだ行っていない。

### 10.13．本番の再照合とbuild修復

2026年9月26日、接続browserの再探索で既存の認証済みCareLink SQL Editorを解決できた。以前のbrowser未接続は現状のblockerではない。SELECTによるschema・policy・migration履歴の限定照合のみ実施。個人情報・申込実データは取得せず、DDL・送信も実施していない。

- PostgreSQL 17.6、intent／photo台帳と両RPCは実体なし。migration 20260926000001〜000003の履歴もなし。
- carelink-uploadsはpublic、MIMEは4画像形式、bucket固有byte上限はNULL。匿名INSERTは旧Allow anonymous uploadでbucket一致のみ。想定したAllow anonymous upload images onlyは存在しない。
- 20260420000011は履歴ありだが、上記policy実体が一致しない。20260628000002、20260919000004は限定照会で履歴なし。既存policyに別途適用されたものもあり、履歴欠損だけを理由に古いmigrationを一括再実行しない。
- queueはdelivery_started_atまでの既存列で、registration_id／notification_kind／template_versionは未作成。salonsのINSERT triggerはon_salon_created_audit。今回の追加migrationはこれら実体とのupgrade照合を追加する必要がある。

HEAD c7b8b6bcのCI 36229069998はfresh applyに成功し、policy RENAMEの失敗は解消。Unit／Contractはphoto型未反映で失敗を維持。E2EはNext16.3.5 Turbopackのfont_file_options_from_query_mapによる内部font URL query解析でproduction buildが失敗し、ブラウザー試験は未実行。成功済み98e5a945以降、font指定／Next設定／依存lock／TLS wrapperに差分なし。外部Google Fonts応答変化が引き金かはログにURL全文がなく未確定。

公式にサポートされたnext build --webpackを通常buildに設定し、Vercelもnpm run buildへ明示してCIとの差を作らない。書体・TLS・CSP・型検査・CI成功条件は維持。根拠はNext.js公式version16移行ガイドと同versionのnext_font/google/mod.rs。build方式の一致testと独立レビューは成功したが、実production build／E2Eの成功は次CIで別途確認する。

### 10.14．Storage実体ドリフトの限定修復準備

未deployのmigration003を、本番で確認した旧policy名にも対応させる。known 2名のrole=anon／INSERT／PERMISSIVEを要求し、同一transactionで両known名を除去後、salons/画像だけのpolicyを作成する。旧migration全体の再実行は他bucketのownershipを緩める可能性があるため採用しない。本番では適用直前に全Storage書込みpolicyを再照合し、未観測の別名permissive policy、known名の独自制限があれば計画を再判定する。現guardだけで未知設定全てを拒否するとは主張しない。

使い捨てDBのupgrade試験は、実migrationのmarker内SQLを実行する。旧のみ・新のみ・両方・privateかつ5MiB/pngの既存制限を各transactionで検証しROLLBACK。許可INSERTを先に成功させ、v2prefix／別prefix／SVGの拒否を実roleで確認する。不明policy／異なるrole／MIME不一致は期待する固定メッセージの例外だけを成功とし、その他SQL障害は失敗させる。他policyの集合一致を確認する。独立レビュー追加指摘0、環境guardと期限migration整合の16test成功。実SQLとmanaged StorageのDROP/CREATE権限は変更後CIで検証する。

### 10.15．ビルド時フォント外部依存の除去準備

3cae4c89のCI 36230017333はWebpackへ進んだが、next/font/googleのloader.js:122でfont URL末尾の拡張子抽出がnullとなり失敗。bundler変更だけでは解決しないことを実測した。Notoの書体は変更せず、OFL-1.1のFontsource variable package 5.3.0をintegrity付きlockで固定し、同梱unicode-range CSS／woff2を通常assetとして配信する。本文100〜900、見出し200〜900の可変軸で従来weight400/500/700を維持する。display=swap、同origin配信を維持し、Google Fontsへのビルド時要求をなくす。

根拠は https://fontsource.org/docs/getting-started/install と取得した両packageのindex.css／registry metadata。展開サイズは両package計約13MBだが、ブラウザーはunicode-rangeで必要subsetだけ取得する。実転送量・フォントloadはE2Eで確認する。既存next/fontの自動preload／fallback metricsとは異なるため、ブラウザーで日本語faceのloadedと表示を確認し、単にfallbackで表示されただけでは合格にしない。

同時にNextを16.3.6へ固定更新する。公式GHSA-vcvr-r3jv-pc5jは16.3.5をaffectedに含めるが、当projectのapi/ogはedge runtimeであり、公式の影響除外条件に一致する。利用者からのSVG値がNode ImageResponseへ到達することは今回確認していないため、CareLinkのRCE実証とは報告しない。根拠 https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j 。修正版依存でのCI/buildは別途必須。local node_modulesが旧版の間はlocal検証を新版CIの代替にしない。

localの型検査・対象lint・関連4suite50testが成功。npmはlockのみ更新し、依存差分はfont2packageとNext/env/SWCのpatch更新に限定。node_modulesは変更せず、local Nodeはengine推奨より古い22.16.0であるため、新版依存＋CI Node24での実証が必須。独立レビュー追加指摘0。ただし新版実build・font/Storage E2E・upgrade SQLは次CIで確認する。本番設定・DB・利用者データ・公開状態は変更していない。

### 10.16．9cc検証結果と署名専用移行への修正

SHA 9ccdd05f654357cdedc15a2126ae3f5c3da1f080、CI 36230756559。production build成功、E2E287成功・2失敗・skipなし。日本語font faceとStorageの既存6ケースは成功。失敗2件はpayment.spec.tsがbody.textContent内の非表示RSC chunk番号8500をHTTP500と誤認したもの。決済機能は変更せず、未提供URLの回帰テストをHTTP応答とvisibleな404見出しで判定する。Nextのstreamed not-foundは200となり得るため200/404＋見出しを必須とする（https://nextjs.org/docs/app/api-reference/file-conventions/not-found）。支払い完了の実装・成功を意味しない。

同SHAのUnitは8024成功・schema/type同期1失敗、Contractはphoto台帳／RPC未適用2失敗、hosted stagingの16ケースは未実行。いずれも成功扱いにしない。schema run 36230756546はfresh、upgrade、role、rollback、20client競合に成功。anon-write-policy-lint 36230756552は再作成した匿名INSERTを拒否した。既存の広い匿名uploadを狭めるだけではserver検証の迂回が残るため、例外登録やダミーauthで通さず署名uploadへ統一する。

移行計画をexpand/contractへ修正する。未本番適用の003をphoto台帳／RPC追加だけへ限定し、Storage設定と旧匿名INSERT撤去は004へ分離する。003適用済みから004へのupgradeを実004のSQLで検証し、無関係なpolicyを保持する。004前は旧直接uploadが可能であり安全性の最終合格ではない。本番の一括db pushは行わない。コード配信、写真経路切替、004適用、v2受付有効化を別nodeとして扱う。写真の署名経路と旧tabの入力・写真保持／復帰が確認できるまで004を適用しない。原子的commit／claimが完成するまでv2受付flagを本番で有効にしない。具体的切替・復旧の実機証拠は未完了である。

写真準備helper/APIを追加。feature flag、CSRF／rate、strict input、intent別Cookie、service専用RPC、返却1行／outcome／pathを検証する。実objectのbucket/path/MIME/size一致時だけuploadedを返し、不一致はconflict。Storageの明示的なObject not foundだけ署名へ進み、通信障害／不明404／bucket不在はunavailable。tokenはupsert=falseで発行し、raw provider error／proof／signed URLをログや応答へ出さない。呼出型overrideは候補migration用であり、prod drift gateの入力を差し替えない。

関連4suite94test成功。helper/APIの65testはbranch/function/line各100％、statement98.5％。upsert=trueへの一時変異で2件RED、直ちにfalse復元・残存なし・65件再成功を確認した。型検査と対象Lint成功。固定helper/APIの独立レビューは追加P0〜P3ゼロ。ただしmockの合格は実Storage契約の代用ではない。実SDKの不存在応答、API署名→upload→同選択照会、別intent有効proof拒否、並行署名後のoverwrite拒否は次CIで必須。004分離後のupgradeも再実行する。

追加レビューで、並行署名のtoken不正でも一般403拒否をimmutability成功と数えるP2を発見。両tokenの構造検証とduplicate固有応答への限定、実不正token負対照、VMで実E2E分類関数を検証する14ケースを追加した。再レビューで当該P2解消・追加指摘0。型overrideの既存回帰を含む5suite124testと対象Lintが成功。providerの実code/message契約は次CIの結果で判定する。

### 10.17．署名uploadの実証と受付確定API

39b27c73e886b2d654a77c1c18c3bae93914f16dを既存PRへpush。CI 36239897941のE2E291件、local DB Contract15件はskipなしで成功した。署名準備API、実SDKのobject不存在、並行署名、duplicate固有拒否、metadata再照合、他intentの有効proof拒否を使い捨て環境で確認。schema run 36239897943、anon-write-policy-lint、Security、Lint／型も成功。Unit8103成功・2失敗（snapshot／生成型不整合、写真helperのidentity検査未認識）、Contract2失敗・15成功・hosted staging16未実行。全体緑ではない。identity検査はRPCで実認可するhelperの呼出しを認識させ、コメント・文字列では通らない負対照を追加する。本番型の不整合は偽装せず未完了を維持する。

REG-03／04／05／16に対応する受付確定APIを追加。inputは事業項目・intent UUID・最大7photo IDだけで、clientのphoto URL／公開状態／claim指定を拒否する。capabilityをstatus照合してから同intentの不変manifestを読む。件数・ID・slot一意性・生成path・Storage metadataを確認し、slot順のURLをserverで作成してcanonical HMACへ含める。確定済みのreplayはStorage通信を省くが、RPCのHMAC一致を省かない。atomic RPC開始後の応答喪失／不正応答はunknown202であり、失敗確定でも成功でもない。proof Cookieを維持し、legacy claim Cookieをpublic receiptから新設しない。外部送信・写真削除は行わない。

独立レビューでStorageの5xx等をphoto不適合409と分類するP2を発見し修正。明示的object不存在／取得成功後metadata不一致と、依存先障害503を分離した。取得成功と業務成功の混同を避ける。写真照合はDB transaction外だが、003のmanifest変更禁止、004後のStorage変更禁止、upsert falseとcleanup未実装を前提とする。将来cleanupは同intent lock内で受付参照を再照合しなければならない。これら完成前にv2 flagを本番有効化しない。

空env・network遮断下で関連6suite197test成功。受付helper／APIのbranch・function・lineは100％（statement99％）。他intent判定を一時無効にする変異で当該テストのREDを確認し、同一hashへ復元した。型検査・対象Lint成功。実APIの同時commit→同receipt／2outbox、異内容409、photo未upload／他intent拒否、実commit後connectionreset→status照会→replayのE2Eを追加する。これら受付APIの実ブラウザー実証は次SHAのCIで必須であり、39bの成功は流用しない。

UI切替、原子的店舗claim、過去台帳の他wave、本番migration実体と履歴／生成型、hosted staging、merge・deploy・実動作は引き続き未完了。今回の局所nodeは全修正完了を意味しない。

最終独立レビューで、写真／受付E2Eがfirst-retry traceへ合成capabilityを保存し得るP2を確認。該当specのtrace／screenshot／videoをoffにし、実specをVM評価するguardで強制する。検証自体は省略しない。実申込・本番資格情報を使用した試験ではなく、本番漏えいを確認したという意味ではない。並行API試験のPromise.allはDB lock重複の証明ではないため、既存20clientの実lock待機試験と併用する。
