# 旧タブ回収の実施条件

対象は旧 main `3d8e6c53` の掲載フォーム。送信前の入力と File は React のメモリーにあり、旧タブに期限・lease・heartbeatはない。店舗の受付DBと画像件数だけでは、まだ送信していないタブを列挙できない。直近の書込みがゼロでも、完全排出の証拠にはしない。

## 配信を変えずに実施できる回収

旧写真部品は、元 File を FileReader で data URL にしてプレビューする。このバイト列は圧縮前のもの。写真選択 input はプレビュー表示後にDOMから消えるため、input.files だけを読む方式では回収できない。基本・詳細の入力欄は各段階でDOMから外れる一方、PR・写真はhiddenのまま残る。

`scripts/salon-legacy-tab-rescue.mjs` はこの固定DOM契約から、利用者の明示操作で各画面の入力とプレビューを読み、既存のローカル下書き形式にする運用補助。アプリには組み込まず、自動実行しない。React内部、Cookie、sessionStorage、localStorage、認可情報に触れず、送信・reload・外部画像取得を行わない。編集した画面は再回収が必要で、保存前後の変化や送信中・確認ダイアログ・結果不明の画面を拒否する。

操作は信頼できる担当者と本人が確認してから、本人の既存タブで行う。未知の第三者のコードをConsoleへ貼る運用ではなく、当該PRの固定SHA・スクリプト内容を確認する。DevToolsの警告・制限を無効化しない。Consoleが使えない環境では本人が入力を控え、元写真の所在を確認する手順を選ぶ。

1. 旧タブを更新・閉じず、送信していないか、写真拒否が掲載POSTより前と確認できるかを本人に確認。送信済み・結果不明なら先に受付を確認する。
2. `node scripts/print-salon-legacy-tab-rescue.mjs` の出力を確認し、本人の旧タブで一度だけ起動する。`window.carelinkLegacyRescue.capture()` をPR・写真画面、詳細画面、基本画面でそれぞれ実行する。画面移動は本人が既存の戻る操作を使う。captureの結果に個人情報は表示せず、回収済み画面と写真枚数を示す。
3. 3画面と写真枚数を確認し、`await window.carelinkLegacyRescue.buildBackup({unsentConfirmed:true, confirmedPhotoCount:確認した枚数})` でBlobを得る。これは本人の未送信申告であり、送信履歴の証明ではない。Blobを本人が管理する保存先へ手動保存する。自動ダウンロードや自動永続保存はしない。

   手動保存の例（写真1枚を本人が確認した場合）：
   ```js
   const recovered = await window.carelinkLegacyRescue.buildBackup({unsentConfirmed:true, confirmedPhotoCount:1});
   const saveLink = document.createElement('a');
   saveLink.href = URL.createObjectURL(recovered);
   saveLink.download = 'carelink-recovered-draft.json';
   saveLink.click();
   setTimeout(() => URL.revokeObjectURL(saveLink.href), 1000);
   ```

4. 新しいフォームの空のタブでバックアップを読み込み、入力・写真の順序・バイト列を確認する。復元が拒否されたら旧タブを閉じない。住所の導出値はnullから再確認し、写真の元ファイル名・更新時刻は旧DOMから取得できないため合成値になる。元画像bytes・MIME・枠順序は保持する。入力制限を超える途中の値は新しい復元側に拒否され得るため、復元完了を回収完了の条件にする。
5. 実際の送信は別の本人操作・承認。保存・復元確認後、`window.carelinkLegacyRescue.dispose()` と `delete window.carelinkLegacyRescue` で補助ツールを終了する。ファイルには連絡先と写真が入るため保存先・保持・削除を本人が管理する。

## 切替判断の具体的な門

- 新consumer配信SHA、V2有効化状態、本人の必要な回収先が確認できている。
- 把握できた旧タブは、未入力で終了、回収ファイルの復元確認済み、又は送信結果照合済みのいずれかとして記録する。回収証拠は利用者識別子の代わりに作業番号・状態・日時・ファイルhash・写真枠数を非公開台帳へ残す。
- 把握できない旧タブをゼロとは扱わない。完全無損失を要求するなら、その利用者の所在・回収確認が必要。確認できないタブが拒否され得る限定リスクを許容して匿名書込みを止めるかは、利用状況の観測期間と限界を示して運営者が判断する。単なる72時間待機は門にならない。
- 全policy・migration履歴・bucket上限/MIME・provider全体容量を適用直前に照合し、承認した正式migrationのdry-run batchと一致する。署名なし拒否と正常署名uploadは隔離環境の証拠を使用し、本番のテスト作成は別承認。

## 承認対象・復旧

まずPRのmergeと本番配信、それとは別にV2有効化・正式Storage切替を判断する。切替候補の固定SQLはdeferredの `20260927000001_salon_signed_upload_cutover.sql`、SHA-256 `f3f32611c5bee4c8406f27f1217d5bf26db50e744470abae4163cf2e41df7122`。正式versionは全履歴照合後に固定する。対象は `carelink-uploads` の匿名INSERT、最大10MiB（既存の厳しい上限は維持）、既存MIMEと画像4形式の共通部分。公開読取と既存画像を保持し、削除・送信を含めない。

切替前の配信障害なら前の配信へ戻す案を提示できる。切替後はV2を維持し、受付結果不明を照合して修正する。flagをOFFにして旧匿名uploadへ戻すだけでは復旧しない。匿名INSERTの再追加は元の危険を再開放するため、個別の明示承認が必要。SQLの失敗・結果不明では、再適用前に実体と履歴を確認する。

## 保存方針の決定事項

下書きは現案の本人による手動ファイル保存を基本にできる。自動保存を追加するなら、本人のopt-in、保存場所、期限、削除操作、共用端末と容量失敗時の扱いを先に決める。旧タブへ自動保存を遡って導入することはできない。

退会後の業務記録は、公開停止後に必要な項目を目的・項目別期間の範囲で保持する案、又は引継ぎ・未処理業務を整理した上で実削除する案を運営者が選ぶ。具体の日数、対象、起算点、匿名化、backup、他ownerの扱いを決めるまで、既存の保持を適法・適切と断定したり、規約へ追認したりしない。

## 検証範囲

元RegisterFormと元MultiPhotoUploadの固定fixtureを使い、未送信の旧UIを画面往復して回収し、現行importへ読み込むJSDOM検証。元画像bytesと順序、入力、通信・uploadゼロ、編集後再回収、hash計算中の変更拒否を確認する。これは特定利用者の実ブラウザ・全過去版・全旧タブの回収完了証拠ではない。
