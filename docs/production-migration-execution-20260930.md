# 今回限定の公式migration実行記録

## 最新の適用結果（2026年10月2日）

CareLink production `xzafxiupbflvgbarrihe`へ、下記10件を公式`apply_migration`で依存順に一件ずつ適用した。SQL Editor直接DDL、履歴repair、履歴INSERT、全未適用原票の一括push、顧客業務行のDMLは行っていない。

- 適用対象固定SHAは`7e77a3cbd49481f4dd7f29d2f99e28059a10d262`。CI `36899878984`ではproduction build、隔離Supabase実API Contract 17件、実ブラウザ310件が成功し、flaky・skipは0。PG17全再生run `36899878858`と必要な静的guardも成功。独立した固定snapshotレビューを適用前に完了した。
- r44 manifest・副作用・local／remote契約hashは固定値と一致。認証済み現在taskの修正・本番反映依頼とNATIVE_PRODUCTIONの効果条件に基づく。追加費用、実返信、実店舗公開代行、実アカウント削除を含めない。
- 適用直前はACTIVE_HEALTHY、PG17.6、長時間transaction・blocked session各0、今回候補の履歴・新table・対象index／trigger各0。既存返信・visit・審査queue各0、visit重複・tenant不一致各0。既存function定義とACLを最小投影で保存した。
- 10件すべて公式成功応答後、履歴が一件・statementsが一要素・記録SQLが原票と完全一致することを直ちに確認した。結果不明や再送は発生していない。下の未共有候補だけを公式versionに同期し、SQL bytesは不変。既存共有原票・既存履歴は変更していない。

| 旧候補version | 公式記録version | migration名 | SQL SHA-256 | 履歴SQL照合 |
|---|---|---|---|---|
| 20260930144930 | 20261002012015 | inquiry_reply_reconciliation | ef346c3ac3755670b233bc032693d63b9f598532ddd8e7ab12d2e993fbe826be | 完全一致 |
| 20260930161629 | 20261002012045 | listing_booking_separation | 75d9b019909a7a7d401890042940397f2d292e2db1e4cd3565d2d258d5e4d61b | 完全一致 |
| 20260930175409 | 20261002012054 | registration_recovery_grants | c50aa91aa07c091439f5aa552fafeb79c86b51bb979325a2259af7e5d9f8f171 | 完全一致 |
| 20261001002400 | 20261002012128 | registration_duplicate_linkage | 50898506c55782577f74e063efc34339d7cb821116f3722093eaf86acd436a91 | 完全一致 |
| 20261001042125 | 20261002012132 | manual_booking_idempotency | f0665e39bcc55cf1760233abda2526e267fcfc539044cdef849a6da4d4b1ff9a | 完全一致 |
| 20261001045826 | 20261002012136 | booking_visits_atomic | f3ffb05d34ca8314d7dd4885d148b95a0443ab3a48abf50dea44c16246b60034 | 完全一致 |
| 20261001050835 | 20261002012204 | event_email_first_delivery_ledger | 860c3f2ff842b9b71c218757f6709612bb18cc0bf5ba9ff0de6bc00f7f32e4ad | 完全一致 |
| 20261001054616 | 20261002012209 | chain_statistics_aggregate | 725ddaee372f579836eaab3d8a4168e756d008dc2c13b31cdc9f34004b0b5377 | 完全一致 |
| 20261001074255 | 20261002012217 | booking_transition_outbox_and_publish_authorization | 0dc96bc4278137877d530701a608c94077fadc3010d2508d16a360a26892e17c | 完全一致 |
| 20261001161628 | 20261002012223 | moderation_rpc_service_only | 635776393571cb9cb983f58f676248b4606771860372ada0acad786079a87bd5 | 完全一致 |

事後に28関数の定義hash・SECURITY DEFINER・search_path・anon／authenticated／service EXEC権限が、隔離PG17の期待配列と完全一致した。新4tableはRLS有効・anon／authenticated SELECT拒否・service SELECT許可。対象5indexはvalid、6triggerは指定tableで有効、2CHECKはvalidated。enqueue_moderationはbody・owner・search_pathを維持し一般roleの直接実行だけを拒否した。

既存業務行の限定aggregateは適用前後同一（profiles 7、salons 10、facility_profiles 5、facility_members 5、bookings 1、visit／返信／queue各0）。新4台帳は各0。これは当時の整合確認であり、将来の件数仕様や個別顧客の解決証拠ではない。

公式本番型を再生成して照合した。112table／viewのRowと21対象業務RPCは一致（空白・JSON生成器表現・引数なし表現の差を比較時だけ正規化）。本番MCP生成器とCI CLI生成器の拡張版・generated column／NonNullable表現差があるため、新しいCLI生成済み型を弱い旧生成出力へ全置換していない。生成列の書込み禁止型とJSON非NULL型は保持する。対象外の拡張関数と既知service-only deduct_points_atomic差を全体driftゼロとは扱わない。

security advisorsも取得した。今回のservice-only 4台帳に対する「RLS有効・policyなし」は一般role拒否の設計と一致する。既存view、拡張、trigger関数、公開availability RPC、Auth password設定の警告を消去・非表示にはしていない。advisor表示だけで実害確定とも全体安全とも判定しない。

DB適用・履歴照合は完了したが、version同期後の最新CI、PR merge、deploy済みSHAと変更対象の本番動作は別gateとして継続する。deferred Storage全cutover、Auth／SMTP／Googleの実送達確認、複数店舗の経営判断はこの10件の適用成功に含めない。

## 最低限運用修正の適用前計画（2026年10月1日時点）

この節は実行結果ではない。現在の認証済み依頼「全部修正して」、実行契約revision 5、r44のNATIVE_PRODUCTIONで評価する。適用先は同じCareLink productionだけ。stagingなど別projectへ流用しない。

- 既存認証の公式apply_migrationを使用する。SQL Editor直接DDL、履歴repair、履歴への直接INSERT、既存共有migrationの編集、全未適用migrationの一括pushをしない。
- 最新の固定commitの独立レビューと必須CI（隔離Supabase実API Contract・Chromium/WebKit E2E・PG17全再生を含む）成功後、直前に対象projectのhealth・PG版・長時間transaction・履歴・既存catalogを照合してから進める。
- 下記の10原票だけを依存順に一つずつ適用する。既存名・signature・indexの予期しない衝突、返信provider ID重複、来店booking ID重複／tenant不一致、既存queue constraint違反があれば、そのmigrationへ進まず実体を照合する。業務行を削除・統合して通さない。
- DDLは公式機能のtransactionと履歴記録に委ねる。結果不明では再送せず、migration履歴の記録SQLと関数／column／index／trigger／policy／ACLを照合する。公式生成versionが原票と異なる場合は、初回適用した未共有原票のversionだけを公式記録へ同期し、SQL bytesは不変にする。
- Auth rowの先行KEY SHARE helperは指定IDをlockするだけでAuth列を返さず、service-onlyで一般Auth SELECT権限は増やさない。削除guardは本人／所有施設のactive予約を最終transactionで確認し、予約参照は実FK SET NULLに委ねる。実アカウント削除を検証として実行しない。
- schema追加と既存RPC置換は既存行の一括DMLを含まない。来店triggerは適用後の実予約状態変更で作動する。旧アプリの二重visit INSERTはunique拒否でデータを守るが旧コードはエラー通知し得るため、DB適用後のmerge／deployを同じrelease工程で速やかに行い、旧アプリとの時間差を監視する。
- 失敗時は各migrationのtransaction rollback／未適用を照合し、既存アプリを保持する。成功済みschemaや操作台帳を破壊的にDROPしない。release後の不具合はforward-fixと既存hostingの前SHAへの復帰を効果別に判断し、実送信・実顧客登録・公開代行・新費用を混ぜない。
- 事後は各原票SQLと履歴の完全一致、service許可／anon・authenticated拒否、RLS、index valid、trigger配置、NULL型、業務行件数と整合性を最小投影で確認する。全体fingerprintの対象外差分は別記し、今回の10原票一致と混同しない。本番型は公式実schemaから再生成してlocal生成との対象差分を照合する。
- その後、保護条件を満たすmerge、deploy済みSHA、health、登録／受付回復／無料掲載と予約gate／店舗予約管理／通知監視の実動作を確認する。実メール送信や実顧客処理はこのread-only確認に含めない。

| 原票version | migration名 | 適用内容／事前・事後対象 |
|---|---|---|
| 20260930144930 | inquiry_reply_reconciliation | provider受理ID、返信不変性guard、unique index |
| 20260930161629 | listing_booking_separation | 確認済み営業時間、掲載／予約gate、公開予約原子性、Auth先行lock |
| 20260930175409 | registration_recovery_grants | 本人確認済み原申込の期限付き回復、RLS・service限定 |
| 20261001002400 | registration_duplicate_linkage | 原申込保持・同一店舗の限定関連付け・CAS・監査 |
| 20261001042125 | manual_booking_idempotency | 同一操作1予約・全メニュー保存・不変outbox・再取得 |
| 20261001045826 | booking_visits_atomic | visit unique、NULL email、状態と履歴の同一transaction |
| 20261001050835 | event_email_first_delivery_ledger | 初回providerキー・envelope・開始時刻の不変性 |
| 20261001054616 | chain_statistics_aggregate | 現在権限・tenant・JST月境界・失敗と真の0件の区別 |
| 20261001074255 | booking_transition_outbox_and_publish_authorization | 状態CAS／通知原子性・調整replay・公開認可・最後owner非公開化・退会予約guard |
| 20261001161628 | moderation_rpc_service_only | 審査queueへの匿名・一般会員の直接RPC実行を禁止。service callerと関数bodyは維持 |

追加原票は、実DBのEXECUTE権限と独立した呼出経路レビューで確認したP1の直接影響範囲である。対象はenqueue_moderation(jsonb)のACLだけで、queue行・関数body・owner・search_pathを変更しない。事前に既存定義hashとPUBLIC／anon／authenticated／service権限を取得し、事後にbody不変、PUBLIC／anon／authenticated拒否、service許可、queue件数不変を照合する。復旧は匿名実行の再許可ではなく、正規service callerのforward-fixとする。隔離PGで実role拒否・正常batch・再実行と旧ACLの負対照を必須とし、本番への偽通報送信は行わない。

SQL SHA-256は実行直前の固定commitから算出して履歴SQLと照合する。この節だけを本番適用成功と報告しない。

## 過去の適用記録（2026年9月30日）

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

## 生成物同期の証拠

- PG17のschema-fingerprint run `36692502579`、attempt 1、repository ID `1188003159`、HEAD `3fe081ef5dc99062719d1daa4600d05bfd93908c`。全migration再生後の差分は所在地CHECKのNOT VALID除去1行のみ。
- provider artifact `11086686269`、name `schema-fingerprint-expected`、provider記録ZIP digest `sha256:a86edc9c285e9e7fd5b51fd3a2302aaa53bd9631f0ea69b32ef2ea2cf4f70471`。ダウンロードしたJSONと同期後ファイルのSHA-256は`20b9b9f21c3326ecb9bf7113a764487dd2d9d4a281227d603557ca3c6002eb80`で完全一致。ZIP digestはprovider報告でありlocal再算出ではない。
- 同じHEADのUnit/Coverageは型とschema-snapshotの未同期1件を検出した。失敗を隠さず、既存生成器`gen-schema-snapshot.mjs`から本番生成型を再処理する。今回のfingerprint同期とsnapshot同期後、最新SHAで全必須CIを再実行する。
