# CareLink 再開入口（2026-10-20）

> **2026-10-21 更新（最新の入口）**：まず [docs/handoff/CODEX_INSTRUCTIONS_20261021.md](docs/handoff/CODEX_INSTRUCTIONS_20261021.md) を読む。
> 下の「再開直後の実作業」2 の Render cron 集約（PR #734）は切替完了・旧サービス suspend 済みで、再実施しない。
> PR #739〜#756 はマージ・本番反映済み。残課題と作業手順は同指示書の 3〜4 章が正。
> `scripts/verify-handoff.py` は main では失敗する（マニフェストは `447f71cb` 時点の hash）。照合は同コミットを別ディレクトリに取り出して行う。以下は 2026-10-20 時点の記録。

正式repo: https://github.com/jimuin0/carelink （公開）。新Macでは任意の空ディレクトリへcloneする。旧Macの絶対パス・このチャット・ログイン済みブラウザは不要。最新の機能基準は c33a53ac8c96422e4271e4a47d3403e226cecd91 / PR734。依存バージョンは package-lock.json が正（Next16.3.8 / React19.2 / Node>=22.22.2）。過去AGENTS・docsのNext15等の記載は履歴。

## 再開直後の実作業（優先順）

1. **対象**: 上記公開repoのCareLinkのみ。任意の空フォルダへ `git clone https://github.com/jimuin0/carelink.git`。現行コードの開発再開に過去アーカイブの全移送は不要。
2. **未完了の最優先**: PR734のRender集約について、workspace jimuinのサービス版・切替値・suspend状態・実行ログを読取確認し、[切替手順](docs/render-cron-consolidation.md) と照合する。既に実施済みなら再切替しない。未実施なら既存安全条件と権限を確認して指定の順序で進める。文書更新を外部切替完了としない。
3. **最初の確認は限定する**: `git status --short`、`git rev-parse HEAD`、`python3 scripts/verify-handoff.py`、進行中の関連テスト/デプロイ/cron操作の有無を確認。別作業を停止・上書きしない。manifest対象コミットは `git log -1 --format=%H -- HANDOFF_MANIFEST.json` で特定する。そのコミットが完成した引継ぎ一式であり、資料作成前のコミットではない。
4. **確認済みを再実行しない**: 対象が一致すれば下記および[検証記録](docs/handoff/RESTORE_VERIFICATION.md)の保存結果を使う。同じ全体テストを重複起動しない。関連コード変更・環境差・失敗がある場合だけ必要な再検査を選ぶ。資料だけの変更で全体テストを繰り返さない。通常のブランチ名は `codex/` と既存規則で判断し、不要な確認を挟まない。
5. **認証待ちと独立作業**: Supabase所有者のACL是正は依頼送信済みで完了未確認。重複送信せず対応後に権限を検証する。実Google同意は本人操作で任意機能のため優先を下げる。認証待ちでも現行コードの独立した調査・実装・合成データ検証を続ける。原票149件は過去指摘の照合制約で、現在の開発再開の前提ではない。画像保持・公開・店舗所有は技術不足と分けて本人の事業判断として扱う。着手不能なら具体的阻害要因と、その間に進めた作業を報告する。
6. **予算・禁止・公開条件**: 新規予算なし。秘密・個人情報の公開、無断課金/送信/削除/権限拡大、他案件/他チャットへの越境、ChatGPT内蔵スケジュールは禁止。既存検査基準と下記保留を維持。ブラウザ操作はCodexサイドバー内で行う。

## 新しい環境の準備（必要時のみ）

Node22.22.2以上、Python3、Gitを用意し `npm ci`。file依存2件はrepo内にあり、旧Macのnode_modulesへリンクしない。実際に環境を変えた場合のテストは `npm run test:coverage:ci -- --runInBand`、`npm run lint`、`npx tsc --noEmit`。本番.envをコピーしてテストしない。
起動/DB/E2Eは [.github/workflows/ci.yml](.github/workflows/ci.yml) の使い捨てローカルSupabase手順を使用。`.env.example`のURLは本番なので、そのままseedしない。ローカルSupabaseと合成データ以外へのseed・負荷試験は禁止。

## 最新状況と優先順位

- PR733 / abd8e800: 実装・ローカル検証・本番配信照合の記録あり。573 suites/12,305 tests、branches11,309/11,309、E2E head/main各374。これは過去証拠であり今回の再実行ではない。
- PR734 / c33a53ac: mainへマージ済み。cron集約の575 suites/12,330 tests、100%分岐とCI成功がPRに記録。本番healthは今回healthy/version c33a53aを読取確認。**Renderの切替値・suspend・実ジョブ確認は今回未確認**。18→5サービスへの切替値・suspend状態・実行ログを最優先で読み取り確認する。手順・rollbackは [cron正本](docs/render-cron-consolidation.md)。推測で切替/再送しない。
- Supabase `public.spatial_ref_sys` 公開書込権限: 10/19確認時未修正、所有者supabase_admin。サポート依頼は本人が送信完了と報告。受付番号・対応完了は未確認。再依頼を重複送信せず、所有者対応後ACLを検証する。
- 原票151全文のうち149未回収。名前/hashは [原票索引](docs/handoff/original-source-index.json)。旧Mac原保存先 `/private/tmp/carelink-audit-20260924.8xy8L8` と旧CareLink docsが候補。2件のみ取得済みという過去判定。Git全blob/関連アーカイブ/Drive既知候補で149件は見つからず。旧Mac名の解決、SSH/SMB Bonjourは結果なし。現在Macはpersonal hotspot「kam」だった。旧MacIP/共有可否は未確認。原票回収完了・全指摘解消を認定しない。
- 過去menu500、Safari/nav timeout、health遅延、Render trigger欠落の根因は証拠不足。現行テスト成功で過去原因確定に置換しない。
- 実Google OAuth受入は本人同意待ち。模擬Google+独立PG試験と実provider試験は別。10/19集計ではprepared/started/succeeded/tracked/connected各0。未知のDB外イベント不存在までは未証明。
- 画像保持/公開/店舗所有方針は本人判断待ち。その後の実装はエージェント担当。

## 権限・安全・公開条件

このプロジェクトのみ。他チャットへの連絡・委任なし。ChatGPTスケジュール・予約・リマインダー・将来自動再開は作成/利用しない。既存の外部Render cronは業務システムであり今回勝手に変更しない。
Stripe/決済、キャンセル待ち、Google時差、LINE解除、実顧客返信/代理掲載は明示保留。実顧客通知・実予約/店舗での試験・本人パスワード設定/OAuth同意代行・新規課金・新たな公開/招待/権限拡大は禁止。引継ぎは本番DBコピー公開の許可ではない。新規予算承認なし。CI課金制限時もローカル代替検証を行い、未実行CIと区別する。

## 外部環境・認証

本番 https://carelink-jp.com はVercel、DB/Auth/StorageはSupabase project `xzafxiupbflvgbarrihe`。Renderはworkspace jimuin、既存carelink-cron-envと業務cron。GitHub Secretsはcloneされない。実行コード・デプロイ設定から抽出した変数名は [env索引](docs/handoff/environment-names.json)、テンプレートは.env.example。値は保存しない。
Vercel projectのdeploy/env管理権限、Supabase project SQL/backup/Storage権限、Render workspace読取/必要時deploy権限、GitHub push権限を別アカウントに本人が許可する必要がある。公開repoのcloneは認証不要、push権限は未確認。本人OAuth同意は移転不可。Stripe/LINE/Google/Resend/Slack/Anthropic等は各サービス管理者が必要時に最小権限で再接続する。期限・プラン・各Secret設定有無は今回未確認であり既設定と推測しない。NEWSLETTER_UNSUBSCRIBE_SECRET/VAPIDの無計画な再発行は既存リンク/購読を壊すため避ける。
DB業務データ・Auth・Storageは既存クラウド側に残る。新Mac開発のための本番DB複製は不要。災害復旧にはSupabase管理者によるbackup/PITRの可用性・Storage別バックアップと秘密管理庫を別途確認する。今回は取得・移行・復元実証していない。

## 競合と履歴

別worktreeのcronブランチ de26a2e7 はPR734でマージ済み。ジョブが完了したか・外部操作が確定したかは本番の読取で確認してから作業する。他プロセスを停止しない。古いopen PR640/641/632/646/647/651や依存PRを一括mergeしない。ローカル固有branch/stash一覧は [Git棚卸し](docs/handoff/git-inventory.json)。未push履歴は現行へcherry-pickせず、秘密レビュー未完了のローカル資料として保持している。完全な履歴移送は未実施だが、現行コードの開発再開に必須ではない。元の資料は保持する。

## 配信・復旧

コード変更時は現行CIのcoverage100%・型・lint・E2E/DB契約を維持し、対象commitを固定する。main更新だけで配信完了としない。Vercel READY/health/version、Render実行版と本番DBmigrationを個別に照合。以前の配信をpromote/rollbackする際は現行DBとの互換性を検証し、適用済みmigrationを安易に逆実行しない。cron rollbackは専用文書の所有権切替順を守る。今回の引継ぎ文書追加はアプリ挙動を変更しない。

## 別Macでの再開についての確認範囲

現行コードを別アカウント・別Macで再開する手順としては整っています。ただし、別Macでの実ログインと外部サービスの権限確認は未実施なので、そこまで「完璧」とは断定しません。

## 本人が行う操作（全文・順番）

1. **旧GitHubアカウント「jimuin0」でログインする。** [CareLinkの権限設定](https://github.com/jimuin0/carelink/settings/access)を開き、Add peopleから移行先の正確なGitHubユーザー名を招待してください。所有権の移転は不要です。
2. **新GitHubアカウントで招待を承諾する。** 公開コードの取得だけなら招待不要ですが、元リポジトリへ変更を保存するには必要です。
3. **新Macで、使用するアカウントのCodexと新GitHubアカウントへログインする。** Codexの利用契約・ログインと、GitHubのアクセス権は別です。旧MacのCookieや秘密鍵をコピーして渡す必要はありません。
4. **新MacのCodexへ、末尾の依頼文を貼る。** リポジトリの取得、ファイル照合、必要な環境準備はAIに任せてください。
5. **外部サービスの認証を求められた場合だけ対応する。** 最初はRenderのworkspace「jimuin」。VercelのCareLink、Supabaseのproject `xzafxiupbflvgbarrihe`は、必要な作業時に本人認証・アクセス許可を行ってください。GitHubへの招待だけでは、外部サービスの権限やSecretは移りません。課金が発生する変更は、その場で判断してください。
6. **復号鍵は、今は渡さなくて大丈夫です。** 今回は暗号化した移送パッケージを作成しておらず、現行コードの再開に復号鍵は不要です。過去の機密資料を後から移す場合だけ、暗号化ファイルと鍵を別経路で渡します。鍵はパスワード管理庫などで個別共有し、GitHub・Issue・PR・チャットには記載しないでください。

公開GitHubの非機密restart-evidence.tar.gzはgzip圧縮であり暗号化ではありません。元の私的資料は保持し、後日必要なら宛先と暗号方式を決め、暗号化ファイルとSHA256を承認済み経路へ、鍵を別経路へ渡し、受信側の照合・実復号成功まで移行済みとしません。本人以外への招待・権限拡大は勝手に実行しません。[GitHub公式の招待手順](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository)。

保存済みの再開入口はこのRESUME.mdです。直前の引継ぎコミット `7ece6f7fa1e2bc7d7b009c9600597cc35e3b1fa4` ではGitHub読戻しにより1,941ファイルとアーカイブ4件の照合・復元を確認しています。過去資料の全移送や本番DBの復元を完了したという意味ではありません。今回の全文更新後の照合対象は `git log -1 --format=%H -- HANDOFF_MANIFEST.json` で特定してください。

## 別アカウントへ貼る依頼文（全文）

```text
jimuin0/carelink の最新mainを、新しい空の作業フォルダへ取得し、RESUME.md・HANDOFF_AUDIT.md・AGENTS.mdを読んでください。

正式リポジトリ：
https://github.com/jimuin0/carelink

まず現在の差分と進行中ジョブを確認し、引き継ぎ対象との一致を一度だけ確認してください。HANDOFF_MANIFEST.jsonの照合対象コミットを特定し、ファイルのhashを確認してください。一致すれば保存済みの検証結果を使い、理由のない全体再検査や同じ調査の繰り返しは行わないでください。

必要な取得・依存関係の準備・ローカル検証は、あなたが実行してください。通常の作業上の選択は既存規則に従って判断し、不要な確認で止めないでください。

RESUME.mdの「再開直後の実作業」に従い、最初にRenderのworkspace「jimuin」で、PR #734のcron集約についてサービスの配信版・切替値・停止状態・実行ログを読み取り確認してください。実施済みの切替や送信を重複実行しないでください。

資料の要約・再整理だけで終了せず、認証待ちとは独立して進められる実装と検証を続けてください。関連コードの変更、環境差、失敗など具体的な理由がある場合だけ、必要な再検査を選んでください。同じ全体テストを重複起動しないでください。

過去アーカイブの全移送や原票149件の回収を、現行コードの開発再開条件にしないでください。Supabase所有者対応、本人認証、原票待ち、事業判断、保留事項は区別し、未確認を完了扱いにしないでください。今回のコード再開に復号鍵は不要です。

本人認証・新しい権限・事業判断が本当に必要な箇所だけ、対象と理由を具体的に知らせてください。判断が必要なら、確認済みの制約と推奨案をまとめて提示してください。着手できない作業があれば、具体的な阻害要因と、その間に進めた独立作業を示してください。

CareLinkのみ、このセッション内で進めてください。他チャットへの連絡・委任・ChatGPT内蔵スケジュールは禁止です。ブラウザ操作はCodexのサイドバー内で行ってください。

既存の予算・検査基準・停止条件・保留・公開条件を維持してください。秘密情報の公開、元データの削除、無断の課金・実顧客通知・本番予約や店舗の試験変更・権限拡大は行わないでください。

実装済み、検証済み、本番反映済み、実運用確認済みを分け、未実施CIや本番確認を成功扱いにしないでください。
```

過去DB競合スクリプトの旧Mac専用`--local-docker`系モードはポータブルではない。通常psql/CIモードを使い、ハードコードの専用socket安全ガードは削除しない。未push履歴のbundleと入れ子docs差分の未移行はprivate-history-preservation.jsonに記録。
