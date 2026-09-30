# 登録V2の有効化と回復経路の固定計画

## 原依頼と対象

GOAL CARELINK-CUSTOMER-REGISTRATION-20260930のC02・C03・C07の直接影響範囲。原依頼・無料方針・保留範囲・r41はcustomer-registration-remediation-20260930.md revision 2を継承する。今回のSupabase限定認可をVercel認証権限の拡大や顧客実送信の承認へ流用しない。

PR #642はhead `3670bceb6b8ee51dd2edc552558f7aa70f713746` の必須CI成功後、`059ca100607192851f23dd1b510f7c7364fac33c` にmergeされた。両者のtreeは`faa15dd50972248c4d02f3e896dad3a248f9ffa8`で一致。Production deployment `6756054029`はsuccess、公開healthは2026年9月30日18時34分の確認でhealthy、version `059ca10`。merge後CI `36695925134`も必須job成功。本番フォームはV2無効、Vercelの当該設定は未登録。

## 活性化前に除去する問題

独立レビューで、flagをOFFへ戻すと発行済みV2 intentのstatus・summary・photos・commitまで404となり、受付照合と本人への店舗引継ぎを阻害すると判明。V1フォームは保存済みV2 contextを無視し、結果不明後の新規再送を許し得る。これは新規停止と既存回復の混同であり、flagを変更する前に修正する。

新規UIの既定選択とprepareだけをflagで制御し、既存intentのAPIはCSRF・rate limit・選択cookie・DBでのproof照合・期限・immutable payload・ownershipを維持して利用可能にする。新規prepareはOFF時404のまま。フォームは入力許可前に同じタブの保存contextを確認し、既存contextがあればV2で照合する。破損・storage読取不能・結果不明はV1へ落とさず抑止する。

## 必須検証

- OFFで新規prepareはDBに触れず拒否し、既存capabilityのstatus・summary・photos・commitは正常と異常の応答を保持する。
- OFFでも匿名、別intent cookie、不正入力、CSRF、期限切れ、DB失敗は認可を緩めない。
- V2結果不明→OFF再読込でV1 POST／匿名upload／新規prepareを実行せず、同じintentだけ照合する。
- preparedを持つOFFフォームは同じintentを完了できる。confirmedは完了画面へ進む。破損contextはfail closed。空contextは既存V1互換を維持する。
- latest SHAのlint・型・全unit/coverage・実API Contract・PG17 schema・production build・Chromium/WebKit E2E・securityと固定snapshot独立review。

## 本番の段階順序

最新の修正が保護merge・deploy・healthまで成功した後にだけ、Productionの非secret config `SALON_REGISTRATION_V2_ENABLED` 1件をtrueへ設定し、同じ検証済みSHAを一度だけredeployする。設定の不存在／現在値、対象project・environmentを直前照合し、失敗や結果不明では実設定とdeploymentのprovider記録を先に照合する。料金契約・secretの発行／開示・顧客実申込・実メールは含めない。

deferred Storage cutoverは適用しない。既存V1タブ用の匿名upload互換を維持するため、署名なしupload拒否済みとは報告しない。cutoverには旧フォームの排出又は検証済み互換経路が別途必要。rollbackはflag=falseと検証済みconsumerの再deployで新規V2準備だけを停止し、発行済みintentの回復APIとフォームのcontext判定は残す。APIを閉鎖する旧consumerへ戻さない。

本番ではSHA・health・公開フォーム・項目別案内・新規prepareの不正schema拒否・capabilityなしの拒否・migration履歴と実体を確認する。申込情報を伴う正常受付と受信箱到達は隔離E2Eの成功で代用せず、事実入力と承認がある実業務に限り別に確認する。
