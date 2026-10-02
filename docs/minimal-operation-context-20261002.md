# 最低限運用の認証・店舗文脈修正

## 契約

GOAL ID：CARELINK-MINIMAL-CONTEXT-20261002、revision：1。
原依頼：現在の「再開」は「優先順位つけて上から順に進めて全部解決させて」を継続する。最低限の予約管理と無料掲載の仕組みを整え、無料掲載と予約を分離する方針を維持する。
この修正単位は全体GOALの一部であり、これだけで全未修正ゼロとは認定しない。

作業用checkout：carelink-ops-remediation-20260921。
branch：codex/minimal-operation-context-20261002。
base：da7f963506ffdd7811dd2eecf7bc89567d014445。
共通規則：2026年10月1日-r44。同一bundleの品質、準備、Git local・remote、副作用、実機規則を適用する。

## 要求と受入条件

| ID | 原要求・根拠 | 修正・証拠 | 合格条件 |
|---|---|---|---|
| C01 | 障害時にも管理運用を安全に復旧できること。権限確認の失敗は権限なしの証明ではない | middleware・権限照会の異常系テスト | DBエラー・dataとerrorの併存・例外は503、no-store。CSP・更新Cookieを保持し、権限付与・否定キャッシュをしない |
| C02 | 未ログインと認証障害を区別すること | mypage/layout・復帰導線テスト | 初期化・検証障害ではnav・業務childrenを表示せず再確認を案内。真正な未ログインだけ既存login redirect |
| C03 | 再実行で業務処理や通知を重複させないこと | 既存AccessVerificationUnavailableの再利用 | 再確認は現在のGET文書のreloadのみ。入力送信・メール再送・権限変更をしない |
| C04 | 権限・既存利用者の境界維持 | HMAC・role・platform・匿名回帰、独立固定snapshotレビュー | owner/adminフィルタ、署名cacheのTTL、platform literal true、公開ページのAuth未照会を維持 |
| C05 | マイページの独立Authと件数取得の失敗を正常に見せない | mypage/page・異常系テスト | 独立Authもtri-state。profile失敗を未設定、件数失敗を0へ変換せず、秘匿情報なしの固定エラー |

対象：middlewareの権限照会と初期化、MyPageLayoutとDashboard、復帰UI、その直接テスト・文書。
次単位：Dashboardとメニュー・スタッフ・分析での任意の先頭membership選択、および店舗文脈を失うリンク。未実装のまま本単位へ修正済みとして混ぜない。
対象外：決済・Stripe・キャンセル待ち・Googleカレンダー時差・LINE解除、共通規則改訂、実顧客申込・返信、権限付与、複数ownerを許す事業方針変更。

## 準備・安全条件

既存のverifyAuthUserはverified／unauthenticated／unavailableを区別する。redirectはNext.js制御例外のため依存照会catchの外へ置く。
通常PostgRESTのfetch失敗はerror応答に変換される。throw試験は依存の条件付き失敗を扱う防御であり、過去障害の原因と断定しない。
DB・外部送信・migration変更なし。新しいcredentialも取得しない。実装は単一writer、認可境界は別担当の読取レビューを必須とする。
本番反映は固定snapshot検証と最新SHAの必須CI成功後、provider保護を回避しないmergeと既存Vercel連携を使用する。
復旧は既存配信SHAへのprovider rollbackまたはレビュー済みrevert PRで行う。無関係なdataを操作しない。

## 品質と完了条件

必須：正常・異常・境界・真正な匿名・data+error・throw・署名cache・Cookie/CSP・復帰動作のテスト、lint、型検査、全単体とbranches100%、セキュリティ、production build、隔離Supabase Contract・対象E2E、固定snapshot独立レビュー、最新PR CI、保護merge、配信SHA・health・匿名拒否の本番読取確認。
条件付き：本番schema照合はmigrationがないため本単位では非該当。実顧客メール・実申込による検証は実施しない。
QAM：機能正確性・異常時復帰・UX/accessibility・security/privacy・運用信頼性・保守性を上記gateで判定する。費用は追加契約ゼロ、既存CI/deploy経路のみ。法務/brandは既存表示・無料掲載方針を変更しない。
独立レビュー、未実行・skipを成功扱いしないこと、変更後の再検証を必須とする。全体のAuth/SMTP確認やStorage cutoverなど、別nodeの未完了は残件として開示する。

## 検証記録

実装・最新SHAの検証と本番証拠は、得られた後に追記する。過去の失敗結果は消さない。

初回対象テスト：2 suite、53件成功。lint：exit 0、既存の範囲外warning 4件は残る。型検査：exit 0。
テスト有効性：隔離したSWC transformerだけでmembership障害応答を旧redirectへ戻した。指定した3テスト中2件が期待どおり失敗（exit 1）。他30件はnegative controlの絞込で未実行であり、合格に数えない。元workspaceのmiddleware内容hashは前後一致し、本来transformerで2 suite・53件成功を再確認した。恒久sourceを書き換えず、負例が残らない構成で検証した。
本番の障害注入は行わない。SSR障害分岐の単体試験と、既存の隔離DB権限観測failure→document GET復帰E2E、今回の正常MyPage Auth・匿名拒否E2Eは異なる証拠として区別する。

独立レビューは8ファイル固定snapshotを直接照合した。本体に追加P0〜P3なし。署名改ざんテストの非hex末尾が同一byteへ復号される条件付き不安定性を指摘し、必ず異なるvalid hexへ修正。独立再照合で256組のbyte差分を確認し、指摘解消を認定した。変更後の対象53件と型検査は成功。
全体回帰：451 suite・9379件成功、branches 9390/9390＝100%、lines 99.38%。負例用generatorのexpected errorログはそのエラー拒否を検査するテストの出力であり、全体のexit codeは0。最新PRのbuild・Contract・E2E・Securityはこれから実行するため、まだ成功と記録しない。
前単位PR #660はmerge SHA da7f963506ffdd7811dd2eecf7bc89567d014445。merge後CI 36984720616成功、PG17 36984720657成功、local Contract17件・build・E2E316件成功。本番配信同SHAとhealth確認済み。これは本単位の未commit変更の本番証拠ではない。
