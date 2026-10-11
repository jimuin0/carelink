## 2026-10-11 forward切替案（下記10月2日の計画への追補）

新V2 UIは本番配信され、公開registerのrendered prop `v2Enabled:true`を読取確認した。global50MB、carelink-uploads10MiB/jpg/png/webp/gifも本番で確認済み。旧匿名INSERTはまだ残り、旧タブの排出は証明していない。

正式source `supabase/migrations/20261011054500_salon_signed_upload_cutover.sql`を用意した。旧deferredのmarked SQL sectionはbyte一致。260migration replay、fingerprint2,945一致、関連guard56件と型検査を隔離環境で確認。sourceに存在することと本番適用を区別する。本番への適用は旧タブ影響の本人判断が未受領のため未実行。

旧フォームの保存・移行機能は存在しない。未送信入力や写真をサーバーから回収したり自動復元したりできるとは説明しない。旧タブを壊さずに退役する証拠を得る方法に加え、未送信内容を確保してから再読み込みが必要になる影響を本人が明示的に受け入れる方法を今回の判断として提示している。既存画像は削除しない。

今回の正式適用は、検証したこのforward sourceのみを公式Supabase apply_migrationへ渡す方法を使う。生成remote versionとsource filenameの対応、保存本文hash、bucket/full policy/RLS実体を個別に照合する。古いpendingをまとめてdb pushしたり、SQL Editor DDLや履歴repairで差分を隠したりしない。Source promotionに合わせ、CIの旧post-start overlayを撤去しfresh-applyで一度だけ再生する。

下記の旧「未配信」「deferredだけ」という説明は当時の観測である。最終状態E2Eを旧タブの無損失移行や実メール到達の証拠にしない点、無署名拒否を通信失敗で代用しない点、匿名権限を自動再開放しない点は継続する。

# 登録写真の匿名アップロード切替準備

残件3の適用待ち計画。コード根拠は現在のcheckoutで照合し、本番設定・migration履歴・実権限は別に確認する。本資料だけでは本番解消済みとしない。

## 現在の互換条件

`RegisterForm`のV1分岐は`carelink-uploads`へ直接uploadし、V2分岐はサーバー発行tokenでuploadする。新しく配信するUIをV2へ切り替えても、すでに開かれたV1タブのJavaScriptは置き換わらない。V2 intentの72時間期限はV1フォームの期限ではない。匿名ポリシーを削除するとその旧タブの写真付き申込は失敗する。旧フォームの互換を維持する間、匿名uploadを拒否済みとは報告しない。

したがって`20260927000001_salon_signed_upload_cutover.sql`はdeferredに維持する。正式migrationへの昇格は、新consumerの配信・有効化に加え、旧タブの排出又は検証済み互換経路についての具体的証拠と承認が必要。現行V1には強制期限や保存済み入力を新consumerへ移す機能がないため、経過時間又はStorageの直近件数だけで排出完了とは判定できない。

## 読み取り専用の事前照合

`supabase/deferred-migrations/salon_storage_preflight.sql`を承認済み読取経路で対象projectに実行する。transactionはREAD ONLY、最後にROLLBACKし、個別オブジェクト名・顧客情報・migrationのSQL本文を返さない。bucketが1件あること、public設定、byte上限、MIME、RLS、全Storageポリシー、全migration versionを確認する。未知のINSERT／ALLポリシーは別名でも迂回経路になり得るため、既知2件の削除だけで拒否完成とは判断しない。

容量はV2 API上限10 MiB、切替SQLも10 MiB上限とし、既存のより厳しい上限・public/private・許可MIMEの部分集合を保持する。Supabase全体上限はbucketの値だけでは確定できず、provider設定で別途照合する。既存上限が10 MiB未満又は許可MIMEが狭い場合、APIが受け付けてもStorageが拒否し得るため、実効上限とUI/API表示の整合が次の判断事項となる。上限の緩和を独断で行わない。

## 承認対象と具体的影響

承認対象は対象project・固定SQL SHA・新しい正式migration version・変更する2つの匿名INSERTポリシー・bucket容量/MIMEの差分・旧タブ対処・適用時間・復旧手順を揃えた計画。全未適用migrationと履歴の照合後、公式migrationのdry-runが承認したbatchと一致した場合のみ実行する。SQL Editorによる直接DDL、既記録migrationの編集、履歴のrepairで不一致を隠さない。

影響は旧V1写真uploadの拒否、署名なし直接uploadの拒否、上限超過／非許可MIMEの拒否。既存画像の削除・公開設定変更・顧客への送信は含めない。失敗又は結果不明なら再実行前に履歴と実体を照合する。cutover後にflagをOFFへ戻すだけではV1写真uploadは復旧しない。匿名権限の再追加はセキュリティを再開放する別の承認対象であり、自動rollbackに含めない。

## 必須検証と証拠

1. 隔離環境の同じbrowser contextでV1フォームを開き入力・写真を保持したまま新consumerを配信する。切替前の旧タブが成功し、署名uploadも成功することを確認する。cutoverを行う場合は承認された旧タブ互換経路で入力・写真・申込が失われないことまで確認する。現行の最終状態E2Eは旧タブ互換の証拠ではない。
2. 既存のshadow upgrade fixtureでlegacy／image-only／両方／厳しいbucket設定の保持、不明role・MIMEの拒否、無署名anon／authenticatedの拒否を確認する。最終状態の`salon-photo-storage.spec.ts`で署名tokenの範囲・不変性・容量・MIME・写真所有権・結果不明の回復を確認する。
3. 適用後のbucket／全policy／RLS／migration履歴を再照合し、許可された隔離又は承認済み本番fixtureで正常署名uploadと分類された権限拒否を確認する。通信失敗・401・404・429・500は拒否成功に数えない。本番fixtureの作成・公開・通知・後始末は別途対象を承認する。

参考：[Storage権限](https://supabase.com/docs/guides/storage/security/access-control)、[全体とbucket容量上限](https://supabase.com/docs/guides/storage/uploads/file-limits)。
