# CareLink 残件1〜8の修正・検証台帳

対象は jimuin0/carelink。今回の基準mainは `3d8e6c53b99411b851e6a7e9559c00512cfd9f94`。独立cloneで変更し、既存checkout・未マージPRを変更していない。merge・deploy・本番migration・実送信・実顧客変更・実削除は未実施。本書は全体完了の宣言ではない。

## 原指摘との対応

| 項目 | 修正・準備 | テストと証拠 | 判定・残る条件 |
|---|---|---|---|
| 1 店舗選択 | dashboard／menus／staff／analyticsに既存membership検証と選択UI。複数所属時は未選択。追加・編集・勤務・戻る・PC/mobile/header移動でID保持。URL変更時はフォームと分析の旧データを破棄。shell名称・Realtimeも選択店舗に一致 | server facility-context、staff context、menus tenant、FacilityNavigation、既存IDOR回帰。独立レビューでshell先頭名・分析旧値・スタッフCTAを修正 | コード検証中。本番未反映。5 APIの共通認可でdata+error／例外／不正応答は503 no-store、真正な0件は401。関連202件成功、新helper全指標100% |
| 2 本日の予約 | dashboardの2リンクを `from=当日&to=当日&facility_id=選択店舗` に統一。予約画面の既存契約に一致 | dashboard fixtureはJST当日と両端一致、別店舗ID保持を検査 | コード検証中。本番未反映 |
| 3 旧画像アップロード・容量 | V1とV2の互換／容量差・全体上限・正式cutoverの条件を具体化。READ ONLYのpolicy／履歴／bucket／件数preflight SQL追加 | Storage関連124単体検査成功。PG17履歴SELECT以外READ ONLY成功。本番詳細の読取照合は非公開台帳に保全 | 要承認。権限／容量／履歴の本番詳細は非公開台帳。全体上限は未確認。旧タブには強制期限なし。72時間待つだけで撤去不可。deferred SQLを正式migrationへ昇格・本番適用は未実施 |
| 4 元メール・Google | 現設定・本人メール／callbackの照合計画、本人対象1名・必要なら再送1回、Google本人同意、副作用を限定 | Authログ24h集計と既存コード確認。SMTP／Google現設定GET能力不足 | 未確認。本人アカウント・原メール時刻と本人操作が必要。実送信未許可 |
| 5 一気通貫 | 登録復旧→店舗作成→無料掲載→管理予約→問い合わせの既存隔離E2Eと必要な回帰を確認 | docs/eight-items-e2e-20261002.md。既存Docker環境を保全、task専用stack試行はVM iptables障害 | 隔離E2E・最新SHA CIは検証中。本番テストは対象と後始末の承認後 |
| 6 Render/Cron・通知 | scheduler、一次実行ログ・送達台帳を読取照合。skipped／0件／successと配送成功を区別 | 非公開台帳の時刻／safe locator／件数。結果不明を自動再送・正常化しない | 実行証拠確認済み。個別provider送達未確認、実送信未許可 |
| 7 規約と退会 | 規約の速やかな削除と実装の最終owner非公開／業務記録保持の不一致、3整合案提示 | 規約／privacy／delete実装の照合 | 要判断。保持目的・期間・実削除・規約公開を決定していない。実データ削除禁止維持 |
| 8 残件証拠 | 原指摘ごとに修正・検証・本番証拠を本台帳で対応づけ | PR661 main／production SHA／CI／healthは現在照合済み | 台帳作成済み。今回PRの最終SHAとCI追記予定 |

## 古い記録の訂正

PR661は2026年10月2日マージ済み、main／production配信SHA一致、必須CI・health成功。既存文書の「これからPR／未commit／未適用」はその過去snapshotの状態であり、現状として使用しない。ただしPR661の証拠を今回の変更の配信証拠に流用しない。未マージPR632／640／641等はそのまま保全し、個々の提案が現mainへ既に別PRで入ったかを差分基準で判断する。

現schedulerの一次照合と過去記録の訂正は非公開台帳に保存した。スキル・manualの過去記載は現在の実設定／配送証拠として使用しない。

1アカウント5店舗の自己登録は仕様未決定で追加しない。複数の既存membershipを安全に選択することと、自己登録上限の方針は別事項。顧客への返信・代理掲載、Stripe／決済／キャンセル待ち／Googleカレンダー時差／LINE解除は対象外。

## 今回の検証記録

メニュー・URL契約27件、ナビと既存layout回帰41件成功。独立レビュー後の修正は最新snapshotで再検証する。
テスト有効性はURL helperを隔離taskで先頭店舗固定へ一時戻し、19件中10件の期待失敗を確認（exit 1）。同じbytesへ復元しhash一致、19件成功を再確認。全体検証と負例の並行を避けるため全体カバレッジは中断し、固定版へ再実行する。中断を成功扱いしない。

## 本番確認の固定案

- merge／Vercel反映は最終SHA・CI・独立レビュー確定後、そのPRと変更内容の承認が必要。
- Storageは全policy・履歴・bucket・全体上限の読取照合、V1タブ保存／復元、V2確認後に正式migrationの対象と復旧SQLを固定する。匿名旧タブの権限を閉じると直接uploadが失敗する影響を事前説明する。
- 本人メール確認とGoogleはoperations文書の1名限定計画に従う。
- 本番一気通貫は本人管理の合成アカウント・店舗名を固定。draft作成から開始し、無料掲載公開の外部検索／メール／Cron対象化を事前確認。実顧客の予約・問い合わせへ触れない。作成IDを秘匿台帳に保存し、テスト終了後は非公開・テストデータのみの後始末を別承認する。削除する関連行／画像／Authの順序と保持記録を先に確定する。
- 通知結果不明はprovider根拠なしに再送しない。法務方針の採択・規約公開もユーザー判断。

独立レビュー最終固定版の未解決P0〜P3指摘なし。API negative controlは専用SWC transformerだけでmembership error拒否を外し、9 handlerテストすべて期待失敗（exit1）。恒久source未変更、hash一致。元transformerの全対象再確認を別記録する。
初回production buildは生成PagePropsにデフォルト引数のundefined unionが入り型検査失敗。3 server pageの引数を必須へ修正、直接テスト20件成功、修正後production build exit0、TypeScript完了、全186静的生成完了。dummy loopback環境での公開データquery timeoutは本番障害証拠ではない。初回失敗を消さず記録する。

最終認可・URL helper通常版は2 suite・48件成功。独立再レビューは引数型修正前後のbytes/hash同等性を確認し、2 suite・20件成功。全体lint exit0、既存4warningのみ。新規source・stage差分のgitleaks redacted scanは漏洩候補0。

固定版の全体回帰：457 suite・9464件成功、branches 9379/9379＝100%、lines99.38%、statements98.56%、functions95.58%、exit0。React Compiler負債ratchetは4件で基準一致。generatorのunknown table／usage出力は負例拒否テストの期待出力で、失敗suiteは0。

追加の再試行防御：メニュー取得失敗後のretry開始時にloading=true・facilityId=nullへ戻し、Auth／所属の再確認中に旧操作を表示しない。遅延Auth回帰を追加、関連3 suite・44件成功、独立9件成功、対象lint成功。最終SHAはこの追加を含むCIで再確認する。

初回PR CIのHTTPSブラウザE2Eは315件成功・3件失敗で未合格。2店舗fixtureが複数owner禁止制約に違反していたため、既存仕様のowner＋admin所属へ修正し、実schemaへの全INSERTを隔離DB transactionで成功確認後ROLLBACK。既存スタッフ作成テストは店舗IDを保持する遷移を明示検証へ変更。KPI初回は成功し、serial retryでは先行書込済みfixtureが二次的に期待値を変えていた。期待値は弱めず、最終CIで全体を再検証する。初回失敗を成功扱いしない。

再実行e80aa2ceの単体457suite/9465件・branches100%成功。E2E319成功・1flakyで未合格：Mobile Safariで予約リンク遷移前にdashboard内の同じ顧客名を拾い、次のstaff遷移と競合。クリック前から完全な予約URLを待機し、予約一覧headingへの到達を確認してから当日/別店舗除外を検証するよう修正。sleep・skip・期待値緩和は行わず最終SHAで再実行する。
