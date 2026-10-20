# CareLink 再開入口（2026-10-20）

正式repo: https://github.com/jimuin0/carelink （公開）。新Macでは任意の空ディレクトリへcloneする。旧Macの絶対パス・このチャット・ログイン済みブラウザは不要。最新の機能基準は c33a53ac8c96422e4271e4a47d3403e226cecd91 / PR734。依存バージョンは package-lock.json が正（Next16.3.8 / React19.2 / Node>=22.22.2）。過去AGENTS・docsのNext15等の記載は履歴。

## 最初にすること

1. `git clone https://github.com/jimuin0/carelink.git`。この文書がmainにない期間は `git checkout codex/carelink-portable-handoff-20261020`。
2. `python3 scripts/verify-handoff.py`。manifestの対象全件を照合する。
3. Node22.22.2以上、Python3、Gitを用意し `npm ci`。ローカルfile依存2件はrepo内にあり、旧Macのnode_modulesへリンクしない。
4. `npm run test:coverage:ci -- --runInBand`、`npm run lint`、`npx tsc --noEmit`。本番.envをコピーしてテストしない。
5. 起動/DB/E2Eは [.github/workflows/ci.yml](.github/workflows/ci.yml) の使い捨てローカルSupabase手順を使用。`.env.example`のURLは本番なので、そのままseedしない。ローカルSupabaseと合成データ以外へのseed・負荷試験は禁止。
6. [復元検証](docs/handoff/RESTORE_VERIFICATION.md) と [分類監査](HANDOFF_AUDIT.md) の制約を読み、下記残件から進める。

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

別worktreeのcronブランチ de26a2e7 はPR734でマージ済み。ジョブが完了したか・外部操作が確定したかは本番の読取で確認してから作業する。他プロセスを停止しない。古いopen PR640/641/632/646/647/651や依存PRを一括mergeしない。ローカル固有branch/stash一覧は [Git棚卸し](docs/handoff/git-inventory.json)。未push履歴は現行へcherry-pickせず、秘密レビュー未完了のローカル資料として保持している。完全な履歴移送はまだ未完了。

## 配信・復旧

コード変更時は現行CIのcoverage100%・型・lint・E2E/DB契約を維持し、対象commitを固定する。main更新だけで配信完了としない。Vercel READY/health/version、Render実行版と本番DBmigrationを個別に照合。以前の配信をpromote/rollbackする際は現行DBとの互換性を検証し、適用済みmigrationを安易に逆実行しない。cron rollbackは専用文書の所有権切替順を守る。今回の引継ぎ文書追加はアプリ挙動を変更しない。

## 別アカウントへ貼る依頼文

「このrepoのRESUME.md、HANDOFF_AUDIT.md、HANDOFF_MANIFEST.json、docs/handoff/RESTORE_VERIFICATION.mdを読み、manifestを検証して再開してください。元Mac/旧チャット/ブラウザ状態に依存せず、残件と未移行の機密履歴を区別してください。まずPR734の本番cron切替状態を読み取りで確認し、原票149件回収とSupabase所有者対応を未完了のまま追跡してください。他チャットへの連絡・委任・ChatGPTスケジュールは禁止。保留条件と秘密保護、検査基準を維持し、実施できる実装/検証をこの会話内で進めてください。」

過去DB競合スクリプトの旧Mac専用`--local-docker`系モードはポータブルではない。通常psql/CIモードを使い、ハードコードの専用socket安全ガードは削除しない。未push履歴のbundleと入れ子docs差分の未移行はprivate-history-preservation.jsonに記録。
