# 登録写真Storage切替の実施計画

本資料は本番適用の記録ではない。対象はSupabase project `xzafxiupbflvgbarrihe` の `carelink-uploads`。新consumer、運用者の選択、正式migrationの履歴とSHA、本番の実体確認をそろえるまで「匿名uploadを拒否済み」としない。

## 新consumerで解消する事項

- 申込prepare応答で `consumerVersion:2` と実効 `photoLimits` を確認する。上限はアプリの10 MiBと実bucket設定の小さい方、MIMEはアプリが扱える4形式と実bucket設定の共通部分。取得失敗・dataとerrorの併存・不明設定は、新intent、写真manifest、署名tokenの発行前に拒否する。
- 正常なselectorを受け取った後の不正・欠落handshakeは、そのselectorを保持する。再試行・reload後は同じintentのcookieを検証して設定だけを再確認し、intentを作り直さない。新prepareのflagをOFFにしても、発行済みintentのstatus確認と設定再確認を止めない。署名tokenやcookieの期限は延長しない。
- より厳しいbucket設定は緩和しない。写真発行時にもlive設定を再確認する。Global file size limitはbucket応答から証明できないため、本番Dashboardで別途確認して記録する。
- 端末保存は本人が選ぶ場合だけ有効にする。入力と元の写真を検証して保存・読み戻し、別タブの古いrevisionで上書きしない。規約同意、許認可表明、token、proofは保存しない。既存・結果不明の申込がある間は復元しない。
- 送信前に保存した下書きをロックし、送信結果不明・削除失敗・別タブ・再起動後にも再送用の未送信下書きへ戻さない。同じcoordinatorがcommitを一度も試行していないと明示確認できる写真準備等の失敗では、自分のlocked入力だけをCASで修正できる。サーバーの確定済みmanifestやintentを無断で置換しない。

端末保存の期限と消去の詳しい動作はconsumerの画面説明を正とする。保存済み入力を後から読み込む操作は、申込の受付証拠にはならない。

## すでに開いている旧V1タブ

旧 `3d8e6c53` consumerの実装は、フォーム値と写真FileをReact内だけに保持する。期限、heartbeat、新consumerの受信・更新、手動backup機能はない。新JSを配信しても開いている旧JSは置き換わらない。unsigned匿名Storage要求と第三者の同じ要求を、RLSで旧タブだけ区別して許可することもできない。

旧写真入力はプレビュー表示後にfile inputがunmountし、別stepの入力も画面からunmountする。サーバーには未送信値が届いていないため、全面的な復元をサーバーだけで保証できない。経過時間、V2の72時間期限、直近upload件数0を「すべての旧タブがなくなった」証拠にしない。

したがって運用者が次の実際の影響を選ぶ必要がある。

1. 新consumerを先に配信し、旧匿名uploadを一時維持する。新consumer側の保存・署名経路は改善できるが、匿名INSERT残存は未完了として記録する。期限の経過だけで次段階へ進まない。
2. 日時を定めて匿名INSERTを閉じる。すでに開いている無修正V1タブの写真uploadは拒否される。入力はそのタブのメモリに残るが、自動的な署名移行やreload後の復元は保証されない。利用者が未送信値を控え、元画像を保存・再選択して新画面へ移る対応を受け入れる。これが匿名経路の廃止を完了できる選択である。

第2案の「拒否される旧タブ」を無影響・互換完成と説明しない。旧タブを閉じたり強制reloadしたりしない。実利用者へ通知・連絡する操作は、この技術実装に含めない。

## 旧タブを扱う具体的手順

旧タブを保持したまま、送信したか、写真uploadだけで止まったかを確認する。受付結果が不明なら再送せず、施設名・送信日時を使って受付記録を運用者が確認する。メモリ内の写真や入力を、サーバーで回収できると断言しない。

手動で移る場合は、写真の元ファイルを先に端末で確保する。写真stepで表示されている元画像の保存も候補になるが、他stepへ戻った後に同じプレビューを復元できるとは限らない。元写真を確保してから各stepの値を本人が控え、新画面で再入力・元写真の再選択・同意を行う。送信済み・不明ならこの再入力を新規申込として送らない。元写真や値を確保できないケースは運用者へ確認し、無断で旧タブをreloadしない。

新consumerの「入力と元の写真をバックアップ」または任意の端末保存が使えるタブは、検証された保存を完了してからreloadする。無修正V1タブにこのボタンがあるとは限らない。

## 正式migrationと本番事前確認

1. 既存の `salon_storage_preflight.sql` をREAD ONLYで実行する。本番bucket件数、public/private、byte上限、MIME、RLS、すべてのINSERT/ALL policy、正式migration履歴を照合する。未知の匿名・authenticated書込policyがあれば適用を止め、名前だけではなく実際の権限を再判定する。
2. DashboardのGlobal file size limitを読み取り、bucketおよびアプリ上限との最小値を記録する。Dashboardログイン待ちは「確認済み」にならない。より厳しいglobal/bucket上限やMIMEを独断で緩和しない。
3. 旧タブ影響の選択、本番対象、適用日時、正式migration version、固定SQL SHA、dry-run対象batch、保持する設定差分、復旧手順を一つの台帳へ記録する。旧deferred SQLは記録済みmigrationを書き換えず、公式CLIで新規作成した正式migrationへ移す。
4. 事前・直前の未知policy、設定、履歴差分を止めるgateを置き、承認したbatchと公式dry-runが一致するときだけ適用する。SQL Editorの直接DDLや履歴repairで差分を隠さない。
5. 適用後の全policyとbucket上限/MIME、RLS、migration履歴を再照合する。署名なしanon/authenticated要求の分類された権限拒否と、同じ環境で署名uploadの成功を確認する。通信障害、401、404、429、500をRLS拒否成功と数えない。

既存Storageオブジェクトの削除、公私設定の変更、実店舗の公開・登録、実メール送信は含めない。結果不明なら再実行前に履歴と実体を照合する。flagをOFFにするだけでは旧匿名uploadは戻らない。匿名INSERTを再追加する復旧はセキュリティを再開放するため、別の明示判断を必要とし、自動rollbackに含めない。

## 検証の位置付け

- 新consumerの実Storage E2E、freezeしたV1設定の署名再試行、元画像の手動backup/importは、新consumerの挙動を確認する。無修正旧JSの自動移行の証拠にはしない。
- `legacy-baseline-negative.test.tsx` は保存した旧コンポーネントのsha照合と、policy拒否後もメモリには入力が残る一方、backup・署名移行・reload復元がないことを示すJSDOM検証である。実ブラウザーでの旧JS切替成功と数えない。
- `check-salon-storage-upgrade.mjs`、署名uploadの隔離E2E、本番preflightと適用後の証拠を別々に記録する。実環境の検証は、同じbrowser context、元写真byte/slot順、二重申込なし、失敗・結果不明時の保存、権限拒否と復旧を確認する。

参考: [Supabase Storageの権限](https://supabase.com/docs/guides/storage/security/access-control)、[Global/bucket容量上限](https://supabase.com/docs/guides/storage/uploads/file-limits)、[getBucket API](https://supabase.com/docs/reference/javascript/storage-getbucket)。
