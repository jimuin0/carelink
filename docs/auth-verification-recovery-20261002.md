# 認証確認障害の復旧契約

GOAL ID：CARELINK-AUTH-RECOVERY-20261002、revision 3。独立semantic reviewを受け、認証前rate-limit計数と障害診断通知を業務副作用と区別した。直接認証する問い合わせ更新・返信・審査も到達経路調査に基づき含めた。目的・認可境界は変更しない。
原依頼：現在の認証済みtask contextの「優先順位つけて上から順に進めて全部解決させて」「再開」。原依頼message IDはplatformから公開されていないため作成しない。
共通規則：r44、manifest SHA-256 `dd7b573c7d937373e19e5c038a1588a40a5ba764b164893b98510b7c0698e51d`。
開始snapshot：`829b3c3be8d37978f809f30fd404de339fb83034`、作業branch `codex/auth-verification-recovery-20261002`。既存の未commit変更なし。別checkoutの変更は保持する。

## 目的・対象

Supabase SDKが通信・5xx失敗をthrowではなく `{data:{user:null},error}` で返す場合を、未ログインへ誤分類しない。認証確認不能時はアクセスを許可せず503と再確認可能な説明を返し、ログインへの誤誘導・業務操作の開始を防ぐ。

対象はmiddleware、共通requireAuth、手動予約作成・照合・状態変更、問い合わせ更新・返信GET/POST、登録審査PATCH、登録受付復旧画面と関連テスト。認証失敗理由の自由文・資格情報をログへ渡さない。SDKが更新したCookieとCSPを引き継ぎ、アプリ側でsessionを破棄しない。運営権限の取得失敗も不許可確定とは区別し、最新DBのliteral trueのみ権限を付与する。

認証・tenant認可の緩和、実利用者への送信、顧客申込代行、SMTPの実送達認定は含めない。決済・Stripe・キャンセル待ち・Googleカレンダー時差・LINE解除は既存方針どおり保留。無料掲載と予約の分離、1owner/1施設の方針を維持する。

## 受入条件と証拠

| 原要求・経路 | 受入条件 | 必須証拠 |
|---|---|---|
| 受付の安全な復旧 | 認証通信失敗時にloginへ誘導せず、受付情報と再確認操作を保つ | 共通API・復旧UIの503テスト |
| 店舗管理の一気通貫 | middlewareと予約APIが確認不能を503とし、認証後段のmembership・業務RPC・業務通知を開始しない | middleware・予約GET/POST/statusの異常系 |
| 認証・権限保護 | 真の未認証は401/既存login導線、正常userだけ後段へ進む。errorとuserの併存は拒否 | SDK error class・境界・権限の単体テスト |
| 運用・privacy | no-store、固定コード、固定診断。raw error内容をログ・通知に載せない | 診断spy・ヘッダー・Cookie/CSP検証 |
| 最新版の反映 | 最新HEAD必須CI成功後にprovider-native merge、deploy SHA・health照合 | PR/CI/deployのimmutable参照 |

Quality Acceptance Matrixは機能正確性、異常時UX、accessibility（既存alert/manual retryの維持）、security/privacy、信頼性、復旧、保守性、費用と既存方針を適用する。新たな課金・外部送信・法的契約変更なし。技術変更は独立した固定snapshotレビューを必須とし、親AIは呼出経路を直接確認する。

## 準備判定・検証

SDK auth-js 2.110.8のfetch/GoTrueClientはretryable errorを返却する。現行コードはerrorを未確認、または全errorを401へ変換している。既存の共通guard・DB制約はこのHTTP分類を訂正しない。したがってP2の静的確定である。特定の過去522やSMTP不達の原因と断定しない。

既知の無効sessionだけSDK型とcode/status allowlistで未認証へ分類し、それ以外のerror・壊れた結果・throwは確認不能へ倒す。文字列messageによる判定、getSession/cacheによる代替認証、自動業務再送は行わない。SDKの確認不能を模す隔離テストで認証後段の権限処理・業務書込みゼロを確認する。既存CSRF→rate-limit→authの順序は保持し、認証前のセキュリティ計数RPCと固定した障害診断通知は許容する。

必須gateは対象単体・UI回帰、lint、型検査、全coverage、production build、対象E2E、隔離DB Contract、Security、固定snapshot独立レビュー、最新SHAのCI、merge後deploy/health。外部SMTPと実送達は別nodeの未確認事項として保持する。高risk経路の変更であり、実利用者・本番データを使った障害注入は行わない。

完了は上記gate成功・対象P0〜P3ゼロ・blocking unknownゼロで認定する。この部分の完了をCareLink全体の完了と表現しない。
