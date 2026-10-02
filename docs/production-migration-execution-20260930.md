# 今回限定の公式migration実行記録

## 本番releaseの照合結果（2026年10月2日）

PR #657は検証済みHEAD `0da68f8f383d5d121793d8211fbe302035df1db9`を指定し、providerの保護条件を満たしてsquash mergeした。merge SHAは`5e6bf3c3570b9175dbd41bee88def92d69776a61`、treeは両方とも`1d6f72602140ab4e103500d1292a9b975b17a0fe`で完全一致。強制merge、保護迂回、mainへの直接pushは行っていない。

- 最新main CI `36952815808`は同merge SHAで成功した。447 suite・9,230単体test、branches 100％、隔離Supabase実API Contract 17件、production build、Chromium／WebKit E2E 310件が成功し、E2Eのflaky・skipは0。lint／型・Security・PG17 `36952815810`と静的guardも成功。取消された先行main run `36952641236`は合格証拠として使用していない。
- Vercel production deployment `6799379769`は同merge SHAで成功し、immutable配信URLは`https://carelink-39vzzceoj-jimuin.vercel.app`。本番healthは2026年10月2日10時51分の確認でHTTP 200・healthy・version `5e6bf3c`、Supabase／rate limit／Resend／cronは正常。Stripeは未設定・明示保留であり確認対象に加えていない。
- 公開登録／ログインはHTTP 200、登録V2は有効。未認証の管理画面はloginへ307、管理APIは401。予約管理APIは有効な形のqueryを付けても未認証を401で拒否した。実申込・返信・アカウント削除・公開代行は行っていない。
- deploy後の自動実行としてbooking-reminder、webhook-retry、flag-reviews、cron-heartbeatのログ保存を確認し、その確認窓のerrorは0だった。これはendpointの実行証拠であり、個別のメール受信やschedulerのprovider帰属を証明しない。

今回のreleaseの成功とGOAL全体の完成は区別する。Auth／SMTP／Googleの設定・実送達、Storage匿名upload廃止の互換gate、複数店舗管理方針は残る。下記の既知fingerprint差分も全DB正常と読み替えない。

## 次の直接影響範囲の準備（監視のlocale依存差分）

限定GOALは`CARELINK-CUSTOMER-REGISTRATION-20260930-MONITOR-LOCALE` revision 2。現在の認証済み依頼「優先順位つけて上から順に進めて全部解決させて」をsourceとし、親GOAL revision 5・保留範囲・費用0を維持する。契約JSONのkey昇順canonical SHA-256は`8e0e1853d0b738f685f0190b9b4ef6cf1af304e2f6bc35733e1beae39038ac04`。適用r44 manifest SHA-256は`dd7b573c7d937373e19e5c038a1588a40a5ba764b164893b98510b7c0698e51d`で照合済み。

受入traceは、監視の偽差分／見逃しへの直接修正 → SQL/RPC/JSON生成・CLI/cron本文保持 → 単体とPG17実DDL負対照 → 全migration再生と最新SHA必須CI → service-only公式migrationの事前／履歴／事後照合 → 保護mergeとdeploy SHA/health/対象RPC照合。quality適用は機能正確性、異常時拒否、権限・privacy、再実行、運用監視、保守性、追加費用0。表示はJSON escapingでrecord境界を保ち、業務方針／実メール／他tenantデータ変更は対象外。読取RPCのsignature・return typeは不変で型生成差分は生じない設計。

隔離PG17で243原票再生から2,701 recordを生成し、C／en_US.UTF-8の配列比較は一致した。rollback-only fixtureで43種のcatalog変更・復元、anon/authenticatedの実42501拒否、service成功を確認した。旧RPCを隔離transaction内だけへ戻す負対照はliteral保持検査で失敗し、終了後に新RPC復元とfixture残存0を確認した。実RPC JSONはgenerator→TS engine→CLI engineで5種の実DDL差分を各1missing/1extraで検知、復元後完全一致。単体78件も成功。これはlocal証拠であり、後続CI・本番適用・本番監視解消の代用ではない。

親GOAL revision 5を維持する限定修正。既存`published_facility_location_present`のraw定義とvalidationは保持されているが、fingerprintの`regexp_replace`がDBの文字分類に依存し、同じUnicode空白を本番だけで変換して差分を作る。定数だけの本番read-only対照では、default処理と`COLLATE "C"`処理は異なり、後者はU202F／U205F／U3000／FEFFの文字列を保持した。業務行や設定は変更していない。

独立設計反証後、限定契約revision 2へ更新した。全行regexはASCII literalの二重空白やLFまで消し、TSとCLIの末尾trimもenum変更を隠すため、正規化自体を廃止する。同一queryを新しいchronological migrationでRPCへ転記し、JSON配列をrecord境界の正本とする。生成・比較CLI・cronは有効本文をtrim／LF分割せず、UTF8 byte順を使う。旧LF区切りCLI入力は拒否しJSONのみ受ける。共有済み原票は不変、service-only ACL・空search_path・返却形・監視対象は維持する。

期待JSONは全migrationを隔離PG17へ再生して生成し、手編集・差分allowlist・監視skipでは通さない。同一PG17／search_pathの生deparseを厳密比較するため、将来の整形差も調査対象であり、意味が同じと推定して自動消去しない。実CHECK／DEFAULT／policy／index／enumのASCII・Unicode空白とLF変更、ACL拡大、JSON異常入力を負対照で確認する。現在の区切り形式は任意catalog文字列に対する数学的collision-free形式ではなく、全識別子の完全識別は保証しない。

未履歴のservice-only `deduct_points_atomic`の2項目は別baseline差分として保持し、この修正では削除・変更・無視しない。locale原因の誤検知除去を全DB差分0とは報告しない。独立設計反証、固定版レビュー、対象test／PG17全再生／必須CI、公式migrationの事前・事後照合、保護merge／deploy／対象fingerprint確認が完了条件。現在は設計・最小実証までであり、この後続修正を適用済みとは扱わない。

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
