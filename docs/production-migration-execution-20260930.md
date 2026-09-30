# 今回限定の公式migration実行記録

認可は現在の認証済みtask contextでの神原さんの指示「今回だけ、Supabase公式のmigration機能と事前・事後確認を使う方法を認める」。対象はCareLink production `xzafxiupbflvgbarrihe`。共通規則の恒久変更、業務データ削除、実送信、費用、公開代行は含めない。

実行計画はcustomer-registration-remediation-20260930.md revision 2。独立レビュー時の計画SHA-256は`bccbd76c1997b846263cbd8f01ed8c8429f1ab97e2a130635d8b0bb40e05d42a`。適用方式はSupabase公式`apply_migration`のみ。履歴のversion・記録SQLとrepo原票を照合し、未共有適用候補だけ改名する。`migration repair`、履歴INSERT/DELETE、SQL Editor直接DDLは実行しない。

事前確認はPostgreSQL 17.6、長時間transaction 0。所在地違反、welcome payload違反と全status重複、legacy登録通知、pending返信重複は各0。業務行件数はprofiles 5、salons 10、facility_profiles 4、contact_replies 0。氏名・メール等の実値は取得記録しない。件数は今回の事前結果であり将来の固定仕様ではない。

| 旧原票version | 公式記録version | migration名 | 適用SQL SHA-256 | 履歴・実体照合 |
|---|---|---|---|---|
| 20260930000001 | 20260930074307 | profile_insert_privilege_guard | b9f93971d0571e800ab102f52267d8bceaa86a4e2bc875811a1435698dbd88d6 | 記録SQL一致、INSERT trigger・関数・service許可・anon/authenticated拒否、profiles件数不変 |
| 20260927000001 | 20260930074500 | contact_reply_idempotency | f396a9a697f7ad98f436910b7cb577a8e2a4819e8897100f18a8fca05c8ff501 | 記録SQL一致、unique/valid index・predicate一致、返信件数不変 |
| 20260926000001 | 20260930074844 | salon_submission_intents | 1c0b04b81d3fda465d5a27177c807a5dfa57bd9726d4e1cde5cc87e953708746 | 記録SQLが適用原票と完全一致、公式成功 |
| 20260926000002 | 20260930074857 | salon_intent_capability_expiry | f4a59ca835dc8b906ec2dc28a9b45cb5f8a8e1fbef27c4df3da693bfaf600639 | 記録SQLが適用原票と完全一致、公式成功 |
| 20260926000003 | 20260930075129 | salon_photo_manifest | 4cc9ff1ce7f9bf1178fda2499b65698bb6dc0919c4a58f0d6e1707f232220370 | 記録SQLが適用原票と完全一致、公式成功 |
| 20260926000005 | 20260930075137 | published_facility_location | 2b4b10224eb73ce12637e29a1bb9f2721c5681a2c197916efb75c7fa5cc2e6ea | 記録SQLが適用原票と完全一致、公式成功。当初NOT VALIDで追加し、下記forwardで検証完了 |
| 20260926000006 | 20260930075358 | atomic_facility_setup | 72c8881394a12ba333f2533351ddf7d6d725949b1a7acc8d68ac44202dc4c35e | 記録SQLが適用原票と完全一致、公式成功 |
| 20260926000007 | 20260930075406 | registration_review_revision | 14cb000bb28526a63754e6fd3a1aa4f83fbd2a1ab1f9ad31f41669bd9234559b | 記録SQLが適用原票と完全一致、公式成功 |
| 20260916000001を保持してforward追加 | 20260930075923 | webhook_retry_delivery_start_reconciliation | 2edb0669ac53c5c56f3c5306bd56dfc3926156870b4df285c0f539d65c6b3819 | 記録SQL一致、既存列型・indexのpredicate一致。旧原票・旧履歴は変更しない |
| 新規forward | 20260930082904 | validate_published_facility_location | d860e6747861b09de065c74ddb0f9fd88d6000d2c46582944b3ab8cb478ffda3 | 記録SQL一致、公式成功、convalidated=true。DMLなし |

上記10件は公式機能で適用成功し、記録SQLと原票の完全一致を確認した。適用中に結果不明は発生していない。将来結果不明が発生した場合は、この記録と履歴・実定義から照合し、盲目的に再送しない。

事後確認ではintent/photoのRLS有効、anon/authenticatedのSELECT/INSERT権限なし、serviceのSELECT/INSERT許可を確認。commit/prepare/setup/profileガードはSECURITY INVOKER・空search_path・service EXEC許可・anon/authenticated EXEC拒否。返信・受付通知・welcomeの3unique indexはvalid。業務行件数は事前と同じで、新intent/photoは各0。所在地制約は違反0件を再確認してから公式forward migrationでvalidationを完了し、convalidated=trueを確認した。

型定義は適用後にSupabase公式generate_typescript_typesで本番の実schemaから再生成した。架空の型追加でContractを通していない。生成ファイルSHA-256は`509d9031a49ad5028912a72c8f8090cf0989d57f1f506f6dfffd59367d85bfb2`。nullable引数のoverrideが生成型とのintersectionで狭まる問題はOmit後replaceで修正し、呼出元を含むTypeScript検査は成功した。最新CIは後続で確認する。

全体fingerprintの事前比較には今回の対象外差分も残る。既存`deduct_points_atomic` RPCはserviceのみEXEC可能で、現行アプリ呼出元なし。今回削除・変更しない。所在地CHECKのUnicode空白は実catalogのUTF-8表現と記録SQLで保持を確認したが、fingerprint関数のlocale依存空白正規化によりshadowと本番の表示が異なる。いずれも今回の10件の履歴SQL不一致ではない。全DBの差分0とは報告しない。validation後のCI用fingerprintはPG17でmigration全再生した公式CI成果物から同期し、手編集で合格にしない。

本番schemaの適用、CIの合格、merge、deploy、顧客への返信・掲載完了は別の証拠として記録する。この記録だけではPRの完了を認定しない。
