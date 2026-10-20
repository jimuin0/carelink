# 引継ぎ調査（2026-10-20）

## 範囲と分類

A: GitHub現行mainのソース、lockfile、migration、tests、assets、docs。remote mainはc33a53ac。古いこのMac main abd8e80を正本にしない。
B: 今回の再開入口、規則、原票名/hash索引、Git棚卸し、環境変数名、分類集計、非機密検証記録、復元検査ツール。Gitへ保存する。
C: `.env`、`.vercel`、ブラウザ認証、未レビューのrawログ/SQL応答/証跡、過去保存tar16本、ローカル固有Git履歴、入れ子workの未push差分。**未処理を不要扱いしない**。公開repoへの一括追加は禁止。元Mac内に保持。安全な受取先/暗号鍵の合意がないので未移行。必要時は管理者承認済み秘密管理庫/暗号化保管へ別送し、受信側でSHA256を照合する。未push履歴は公開前に全差分の秘密/個人情報レビューが必要。原稿・原応答・費用・試行回数を含む可能性のあるraw資料は削除しない。
D: Supabase DB/Auth/Storage/backup、Vercel環境変数/配信、Render既存env/ジョブ、GitHub Secrets、Google/LINE/Stripe/Resend/Slack等。既存サービスに保持し、アカウント権限と再認証は別途必要。バックアップ可用性/保持期限/復元は未検証。勝手にコピー/新規権限付与を行わない。
E: node_modules、.next、runtime配布物、coverage/HTML test report、mutation cache、OS/tsbuildinfo。lockfileと記録済みコマンドから再生成。HTMLレポートの元証拠が別に存在することを前提とせず、raw診断はCとして保持。
F: 他案件は探索対象外。旧版を自動で不要にはしない。旧CareLink資料はCの履歴保存とし、現行へ混入させない。

## 発見した漏れ・制約

- ローカルexcludeでAGENTS.md、work/、.local-consolidation全体がGitHubに存在しなかった。再開に必須の最新要約と原票hash索引をBとして追加し、生資料はCへ明示分離。
- package.jsonはNext16/React19なのに旧AGENTSはNext15/React18。新しい入口を正本として解消。
- 最新mainにはPR734のcron集約が入り、PR733までの本番照合記録だけでは現在の外部切替状態を示さない。
- このMacにある全ファイルを公開できるとは確認していない。分類集計はlocal-inventory-summary.json。全ファイル名/hash詳細は機密候補を含むためローカル600権限で保存し、集計とそのhashだけ公開。
- 原票149件は取得不能が継続。旧Mac接続未成立はデータ消失の証明ではない。
- git submodule/symlinkはgit-inventory.jsonを参照。LFS利用は属性とpointer走査で別途検証する。
- 実行中のOSプロセスの一覧から他者の意図や外部未確定操作の不在は断定しない。cron専用worktreeは変更しない。外部操作を今回再実行しない。

## 完了境界

公開できる再開入口と索引のGitHub復元を実証する作業であり、C/Dの完全移行や別実機/別アカウントでの検証完了を意味しない。秘密移行先が未指定のため**元Mac非依存の完全な履歴・証拠移転は未達**。この制約を引継ぎ文書で隠さない。

## 追加確認

Git LFS pointerは追跡ファイルに0。submodule/追跡symlinkの件数はGit棚卸しに記録。4本の過去競合検証スクリプトに旧Mac専用Docker/psqlモードが存在する。安全ガードを外さず、通常の`psql`/CIローカルDBモードを使用する。現行アプリ・npm ciの必須依存ではない。path-dependencies.jsonに対象を記録。

入れ子worktree2件も確認し、一方のdocs/carelink-resume-status.mdに未保存差分1件がある。元checkoutを変更せず保持し、公開レビュー前なのでC。全refのGit bundleをローカル作成・git bundle verify成功。hashをprivate-history-preservation.jsonに保存。これは別Macへの移転完了ではない。

## ローカル限定内容と既存GitHub内容の実照合

初期7,403ファイルのうち3,858件は、ファイル全内容からGit blob IDを計算してremote refsから到達可能なobjectと一致したためAへ変更した。単に同名という判定ではない。Eは22件、Cは3,523件（約1.30GB）。Cを「不要」とはしていない。詳細な秘密候補を含むprivate inventoryとbundleは元Macに保持し、その最新hashと分類集計を公開した。生成ディレクトリをまとめて除外した範囲はこのファイル件数とは別に記録。

## 新Macへ引き継ぐ無視規則

元Macの.git/info/excludeだけにあったwork/と.local-consolidation系の無視規則を共有.gitignoreへ移した。新しいcloneで生証跡や入れ子作業コピーを誤って一括公開しないための予防であり、元ファイルは削除しない。AGENTS.mdは共有の再開規則なので追跡する。
