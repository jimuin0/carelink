# 問い合わせに直結する登録修正の実行契約

## 最低限運用の残件修正（revision 5、追加対象）

認証済みtask contextの追加原文は`全部修正して`（UTF-8・LF・末尾改行なし、SHA-256 `3420199a9f32bba210b2ac3db106e0fa85afbcf6085b01fbb661406c4bfa4c0c`）。GOAL IDを継続し、revision 4の登録・掲載・問い合わせと検証を保持する。

- 開始HEADは`cebffef8997fe1387455d8aee6e6ea2538d48078`。既存未commitを含む1517ファイルのpath/content SHA-256一覧をcanonical JSONとして計算したaggregate SHA-256は`65f32cc5b6d180a6701a0b23e707a8419f045ad8b11a220898b9eb15b16437f5`。secretになり得る.env系は内容記録から除外し、設定値は取得しない。
- 現行共通規則は2026年10月1日-r44。manifest SHA-256 `dd7b573c7d937373e19e5c038a1588a40a5ba764b164893b98510b7c0698e51d` と全7構成hashを照合した。変更された共通本文・準備・実機・副作用・remote契約を全文再読した。品質・local契約は内容hashが同一の読了cacheを利用する。local編集は既存作業checkoutだけ。1owner1店舗、実顧客の返信／掲載承認、追加費用0円、既存データ保持、revision 4の掲載と予約分離を維持する。複数owner店舗を許す変更は経営判断の回答待ちであり、無断解除しない。
- 本番変更はr44のNATIVE_PRODUCTIONへの適合を効果別に確認する。既存認証・公式migration・transaction・標準Git／hostingを利用し、専用承認service不在だけを停止理由にしない。実送信、実roleの拡大、資格情報操作、破壊的DDLは別nodeとして維持する。未検証の適合条件を満たしたと報告しない。
- 対象外は決済・Stripe・キャンセル待ち・Googleカレンダー時差・LINE解除。既存のネット予約や通知を、最短化を理由に無断で削除しない。
- local成果物を本番解消と呼ばない。最新SHAの必須lint・型・coverage・Contract・build・対象E2E・security、独立レビュー、正式migrationのschema／履歴、保護merge・deploy SHA／health／対象動作が完了条件である。

| ID | 確認した問題と受入条件 | 変更／必須検証 |
|---|---|---|
| M01 | 手動複数メニュー予約の部分保存を成功扱いしない | 単一transaction、menu保存失敗時の全rollback、全メニュー表示 |
| M02 | 応答喪失・再実行・並行要求で手動予約を二重作成しない | actor認可とimmutable操作ID、同操作並行・変更入力・権限失効・再実行 |
| M03 | 既存の複数admin所属で予約対象を先頭店舗へ固定しない | 明示facility選択、日送り・検索・詳細・戻りの保持、別店舗拒否 |
| M04 | 予約表・一覧・詳細で全メニューを正しい店舗／順序で表示する | menu_idsを基準、施設scope、欠損・DBエラー・順序・単一menu回帰 |
| M05 | 未通知を「お客様に通知しました」と表示しない | 業務成功判定、宛先無し・arrived・送信失敗、応答喪失と再取得 |
| M06 | 初回メールの結果不明を別操作として無条件再送しない | 初回とretryのimmutable envelope／キー、timeout受理・24時間境界・照合 |
| M07 | 完了予約と来店記録が部分成功で矛盾しない | 3完了経路、email無し、INSERT／DELETE失敗rollback、顧客誤合算禁止 |
| M08 | チェーン集計DB失敗を0件や機能対象外と表示しない | 各依存の失敗と真の空集合を区別、tenant認可、表示回帰 |
| M09 | 状態変更と通知予約の部分成功、調整再送の別UUID化、退会と公開の競合を防ぐ | 状態CASと不変outboxの同一transaction、調整UUIDの永続別名、開始前の予約revision再照合、現在memberとprofile lock、最後のowner退会後の非公開化、owner復帰時の再公開、DB障害と権限失効のUI/API回帰 |

### revision 5の直近検証（本番反映の証拠ではない）

- 所有する隔離PG17.6はUNIX socketのみで起動し、241本のmigrationを適用した。schema fingerprintは2703項目、schema snapshotは112テーブルの照合が成功した。16本のrollback SQL fixtureが成功した。
- M09を含む並行要求は7種類各20件と2 owner同時退会を実DBで検証した。待機lockを観測し、重複予約・二重outbox・権限失効後の変更・owner不在での公開が成立しないことを確認した。実顧客・本番接続設定は使用していない。
- 初回の全体Jestは444 suite・9141 testが通過したが、分岐coverageは9327/9349で必須100％に未達だったため、合格扱いにしなかった。正常・異常・境界の検証を追加した後、445 suite・9186 test、分岐9347/9347（100％）、行12682/12760（99.38％）で成功した。型検査、本番build、lint（既存警告4件）、React debt ratchetも成功した。
- 後続の全変更154ファイルの固定版独立監査で、退会前COUNTと最終Auth削除の間に手動予約がcommitできる新規P2を確認した。Auth削除transactionのBEFORE triggerでmembership→profileをlockして本人／所有施設のactive予約を再確認し、本人予約のuser_id事前NULL化を撤回した。実FK SET NULLがAuth削除transactionで処理する。実DBの応答喪失／Lock待ち検証で予約commit後の退会拒否・Auth/member/予約保持と取消後の退会を確認した。
- owner自身が顧客として予約する場合のAuth FK→profile逆順lock候補も反証し、公開予約／変更RPCはAuth KEY SHAREをday/profileより先に取得するよう統一した。先行onlineの実Lock待ちを観測してから退会を起動する二段検証で、予約先行なら退会拒否、退会先行なら新規予約拒否の両順序が成功した。全155ファイルの固定版独立再監査に新規確定P0〜P3はなかった。
- 最終退会guard追加後の全体Jest再実行は写真保持test1件の時間超過で失敗したため合格扱いにしなかった。同testを含む18件の単独回帰成功後、負荷のある他processを止めて逐次全体再実行し、445 suite・9187 test、分岐9347/9347（100％）、行12682/12760（99.38％）で成功した。最新のlint／build／型検査とCIを別gateとして続行する。CI・merge・deploy・本番migrationはこの実行中の作業では未実施である。
- 実schema型再生成がNOT NULL jsonbをNonNullable<Json>と表したため、既存SDK payload呼出しの型不整合を検出した。object入力の型だけで非nullを保証する案は関数をobjectへ広げた反例で独立監査が拒否し、撤回した。既存toJsonValueのnullable契約を保持し、別のtoNonNullJsonValueが変換後nullを実行時に拒否する。保留中Stripe側は既存payloadのimport／呼出し2行だけを型互換修正し、署名・課金・processed・送信状態の仕様は変更しない。独立再監査と関連62testが成功した。これは決済機能の保留解除ではない。

M01／M02／M07の設計反証を独立監査へ依頼し、lock順序、service-only境界、NULLメール誤合算、直接来店偽造、予約削除時の既存履歴保持を検証条件へ反映した。これは設計確認であり、実装合格ではない。revision 4のQuality Acceptance Matrixを全項目継承し、予約保存／来店／メールの原子性・再実行・権限・復旧を追加する。

### PR #657のCI失敗への対応と優先順位

旧PR #642／#656はマージ済みであり、続行先は既存PR #657、branch `codex/salon-v2-recovery-20260930`。固定HEAD `539dd1bf3aefcd39c77d5df5769ba74d4bf8fd38` のCI run `36868992311` はlint・型・単体／coverage・Security・静的Contractに成功したが、E2Eは11件失敗、19件未実行、276件成功であり全体不合格。PG17 run `36868992204` もfixtureで失敗し、合格とは扱わない。

1. 登録・無料掲載の一気通貫を最優先に、DB作成成功後の管理画面遷移と、応答喪失後の復旧を修正・検証する。
2. 予約管理とCI検証データを正しい準備条件へ整え、同じPRの最新SHAで全必須CIを再実行する。
3. 独立レビューと必須CIの成功後だけ、公式migrationの事前・事後照合を行う。
4. 保護条件を満たすmergeとdeploy SHA／health／変更対象の本番確認を行う。本番解消をlocal成功で代替しない。

| 対象 | 原因と修正 | 検証証拠・残るgate |
|---|---|---|
| 登録後の管理画面／結果不明からの復旧 | 成功応答時に本人のmembership hintだけを失効し、成功時と既存membership確認時はfresh requestへ遷移する。旧署名付きnegative hintはDB再照合し、応答喪失／旧prefetchの遅延応答で否定を固定しない。positiveのHMAC・TTL、DB role filter、CSRF、RLSは維持する | 関連6 suite・140 test、型・変更lintが成功。ネット遮断の別tempで旧negative条件へ戻すと新4 testが失敗、復元後20/20成功、source hash一致。実Auth・API・DB E2Eは最新CIの未完了gate |
| booking準備のE2E | 従来の合成fixtureには写真・確認保存した7曜日営業時間・一部公開menuが不足。予約条件を弱めず、合成事実を明示し実facility_booking_ready RPCを照合する。任意の先頭検索結果や結果なしの条件付きassertを廃止する | 明示したfixtureと両browserの最新E2Eを必須とする。管理画面の無料掲載／予約準備中の文言assertを現行仕様へ合わせ、売上・件数KPI assertは保持 |
| PG17 fixtureの独立性 | 先行concurrency runnerがcommitしたUUIDと次fixtureの衝突、既存queue行を含むglobal件数の誤った前提を修正。別UUID namespaceと既存ID保存を確認するqueue deltaを使用する | 実concurrency後の同じ隔離DBで後続fixtureが成功。既存行を削除して通していない。独立レビューで両SQL fixtureのP0〜P3を未検出。最新PG17 CIを別gateとして維持 |

応答喪失E2EではPlaywrightのroute.fetchが共有cookie jarへ先にSet-Cookieを反映するため、abortだけを「header未着」と扱わない。元の本物の署名付きnegative hintを再注入し、同値が残る前提をbooleanで確認してから再読込する。認証情報の表示・記録、実顧客・本番へのtest書込みは行わない。

追加修正前の全体coverage実行は、独立監査で新しい復旧経路P2を確認したため対象の所有processだけを中断した。途中結果を合格として使用しない。変更後の全必須検証は最新SHAのCIへ戻す。これは本番適用、merge、deployの完了記録ではない。

### E2Eの観測不備の修正（2026年10月2日、再検証待ち）

HEAD `9a8375c8428ceecccf31f0d0833930f2ee8e0181`、CI run `36878394928` はlint・型・単体／coverage・Security・静的Contract・隔離実API Contract・production buildが成功し、E2Eは300件成功・8件失敗した。PG17 run `36878395094` は全migration再生と並行・権限fixtureを完了した。E2Eの失敗を本番解消や全体成功に置き換えない。

| 失敗内訳 | 原因と修正 | 維持する合格条件 |
|---|---|---|
| Chromium 3件 | fresh document遷移がCDP応答bodyを破棄。実POSTの応答をroute.fetchで一度だけ読み、元の応答を未改変で届けてから観測結果を取得する | API成功の偽造・再POST・認可迂回は禁止。実status、state、DB claim／写真／owner／welcome件数とfresh管理画面遷移を確認する |
| mobile 2件 | Cookie bannerが施設作成ボタンを覆う。新しい認証contextで利用者の「必須のみ」を実クリックする | force clickや同意の捏造はしない。通常の画面操作と登録処理を通す |
| 応答喪失 2件 | 詳細文はalert見出しとは別paragraphで、Nextのroute announcerにもalertがある | 成否不明の完全な説明と再読込ボタンを可視確認し、POST回数1、旧署名cookie保持、再読込後owner1件を維持する |
| mobile 1件 | 詳細h1と関連施設cardのh3が同名。対象h1をlevelで特定する | 指定fixtureの施設詳細を確認する。任意の先頭施設や条件付きassertへ変えない |

これらは実際に失敗した検証の観測・操作の修正であり、旧runを合格へ書き換えるものではない。新固定SHAの独立レビューと全必須CI、公式migration、本番反映と対象動作確認を続行する。

次のHEAD `b3a860264695200ca0b4fe531d86183486220306`、run `36882825623` の単体検証は、登録E2Eのguard用VMが新helperのimportを認識しない8件で失敗した。guard条件を削らず、実helperのmodule初期化をI/OのないVMで読み、指定されたimportだけを許可する。未知importは引き続き拒否する。helperの非JSON・fetch／fulfill失敗・未観測・重複POST・非POST・cleanupの回帰検証を追加し、外部通信を遮断した2 suite・16 testは成功した。独立読取レビューでこの2 testの新P0〜P3は未検出。実時間のpoll、認証、DB、browser応答はunitだけでは保証せず、最新CIの実E2Eを別gateとして維持する。

同HEADのCI E2Eは308件すべて成功、隔離実API Contractは16件すべて成功、production buildとPG17全再生も成功した。ただし単体gateの失敗が残るため、merge・本番適用の合格とはしない。helper unit追加後のlocal並列coverageは9,205件成功・登録フォーム2件失敗（分岐9,349/9,349）だった。同2 suiteの単独検証12件は成功したが、これだけで全体合格に置換せず、通信遮断下の全体逐次検証と次の最新SHAの全必須CIを継続する。型・lint・対象16件の成功と固定版独立レビューを、この検証コード修正のcommit前証拠として区別する。

## 掲載と予約の分離（revision 4、現行）

認証済み追加依頼の原文：`無料掲載と予約を分ける`。下のrevision 3に対する事業方針の変更であり、過去の公開準備条件は今回の掲載条件として継承しない。

- GOAL IDは継続、revisionは4。料金・契約、ownerの店舗数制約、顧客の代行返信・代行掲載の承認境界は変えない。
- 掲載公開は権限を持つ運営者の明示操作と、施設名・都道府県・市区町村・住所の確認を必要とする。受付やアカウント作成だけで自動公開しない。
- ネット予約の可否は公開状態と、公開メニュー・写真・有効スタッフ・確認保存済みの全7曜日営業時間から導出する。別のbooleanとの二重管理は追加しない。営業時間はnull、欠損、型違い、時間逆転、全日休業を準備完了にしない。
- 無料掲載は準備未完でも検索・詳細へ出る。ネット予約は準備未完の説明と電話・問い合わせへ誘導し、予約入力画面・公開API・匿名RPC・公開予約確定/変更RPCのいずれからも予約を成立させない。
- 管理者の電話予約等の記録は既存の認証・店舗権限と`p_enforce_schedule=false`の経路を維持する。掲載やネット予約の停止を理由に予約管理表を使えなくしない。
- 既存公開施設にも同じネット予約条件を適用する。営業時間が未設定なら自動で09時〜19時を正しいものとして補完せず、ネット予約の準備未完として表示する。既存予約・個人情報・店舗情報の書換えや削除は行わない。
- G02とU01はこの分離を画面/API/DB/テストで追跡する。F01〜F06、G01/G03/G04は別nodeとして残し、掲載方針の決定だけで完成としない。
- 必須検証：掲載のみの正常系、予約準備あり/なし、各欠損・DB失敗、直呼び・権限・店舗違い、再実行、管理予約維持、既存の競合/勤務窓/バッファ/所有権の回帰。実DBと独立レビュー後、最新SHAの全必須CI、schema/履歴、deployと対象動作を照合する。

順向き照合：「分ける」は掲載gateの解除だけではなく予約拒否を含む。逆向き照合：料金変更、架空メニュー/スタッフ作成、自動掲載、顧客実送信を要求へ追加していない。現在は設計固定・実装中であり合格ではない。

### G01の追加準備判定（revision 4）

- 同一店舗の未取り込み重複受付だけを専用台帳から既存店舗へ関連付ける。`claimed_facility_id`のUNIQUEを解除せず、原申込・写真・intent・claimは不変とする。別支店、取り込み済みの別施設、情報欠損は対象外であり破壊的な施設統合を実装しない。
- DB上のplatform-adminだけが、比較表示を取得し、同一実店舗であることを明示確認する。現在確認済みownerのAuthメール・2申込のメール・現在owner所属・施設の現在identityを再照合する。previewだけで書込みをせず、確定は両申込の観測revisionをCASし、監査と関連付けを原子的に記録する。
- legacy／intent／recoveredの全setupが関連付けを検査する。同じ確認済みownerのみ既存店舗を返し、別利用者にはIDを出さず拒否する。新施設・写真・welcomeを作らない。関連付け済みの同一pairだけ再確認でき、chain・付け替え・自己参照は拒否する。
- 必須検証は権限失効、別店舗、欠損、Authメール変更、claim競合、CAS、同一再実行、監査失敗rollback、全setup mode、原写真保持。原則を満たす狭い機構を独立反証後に実装し、本番での実関連付けは実顧客処理と分離する。
- G02は1ownerアカウント1店舗を維持する。複数admin権限は予約・顧客情報へも広がるため、ownerの明示同意と相手の確認済み認証・受諾なしに追加しない。同一メールの別店舗申込を無断で別ownerへ移すことは別認可設計が必要であり、この関連付けで代用しない。

### G03の準備判定と復旧設計

- 通常のタブ内能力が失われても、再申込ではなく確認済みアカウントから原申込を選択する。検索メールを利用者から受け取らず、getUserとauth.usersの現在のemail・email_confirmed_atを照合する。Gmailのドット・＋tag除去は認可へ流用しない。
- auth.usersの実列3件は公式connectorのmetadata読取で確認した。個人情報は取得していない。Auth全件の読取grantは追加せず、serviceだけ実行可能な小さい固定search_pathのdefiner helperで、Auth行をFOR SHAREし確認状態と一致のbooleanだけを返す。
- 発行・消費のtransactionはuser advisory lock→Auth行→回復grant→元intent（ある場合）→receiptの順を保持する。receipt先行lockからintent wrapperへ戻らない。receiptのemail・claim・審査をlock下で再検査する。
- 回復grantはuser・原receipt・digest・期限を不変にする。proofはHttpOnly cookieにのみ返し、URL・JSON・logへ出さない。別user、期限切れ、別receipt、メール変更は拒否する。発行では申込・施設・写真・通知を変更しない。
- 新modeを既存atomic setup本体へ明示追加する。原intentの写真manifestとslot種別を保持し、元proofの延命やintent payload HMACの置換をしない。license表明と利用者の明示送信は維持する。
- 一覧は本人の最小投影だけを51件読取し50件を表示するkeyset pagination。DB障害を0件にしない。取り込み済み本人申込はreplayし、結果不明から新施設を作らない。
- 設計への独立反証でAuth変更競合、lock順序、V2写真の欠落が指摘され、上の条件へ反映した。これは設計確認であり、実装・実DB・本番合格ではない。

### revision 4の追跡と未完了境界

- 対象checkoutは`carelink-ops-remediation-20260921`、開始HEADは`cebffef8997fe1387455d8aee6e6ea2538d48078`。既存変更を保持し、このcheckoutだけに実装する。
- 下のC01〜C08・F01〜F06・Quality Acceptance Matrixを継承する。ただし掲載の旧メニュー・写真・スタッフ必須条件はこのrevisionの掲載／予約分離で置き換える。
- G01は不変の重複関連付け、G03は現在確認済み本人の原申込復旧を実装対象とする。元申込や実店舗を破壊的に統合しない。実顧客への送信・代行掲載は対象外。
- G02の複数店舗管理は経営方針の未回答nodeとして保持する。1owner1店舗制約を無断解除しない。ownerの同意・確認済み相手の受諾がないadmin付与も行わない。
- 最新変更に対する必須local検証、独立レビュー、最新commitの全必須CI、schema実体／履歴、merge、deploy SHA／health／対象動作をすべて満たすまで機構完成としない。ローカル生成型や隔離PG17成功を本番照合の代わりにしない。
- 保留対象は決済・Stripe・キャンセル待ち・Googleカレンダー時差・LINE解除。新規費用上限0円、利用者の変更破棄・無関係な業務データ変更を禁止する。
- 原依頼のsource SHAは下のrevision 3のexact textの値を維持し、追加sourceはUTF-8・LF・末尾改行なしの`無料掲載と予約を分ける`を固定する。認証済みmessage IDは非公開のため捏造しない。

## 過去の契約と実行記録（revision 3以前）

以下はrevision 3以前の契約・実行記録であり、現在の状態欄ではない。現在の掲載・予約条件は上のrevision 4を優先し、最新証拠は末尾の「revision 4の検証台帳」を参照する。

- GOAL ID：CARELINK-CUSTOMER-REGISTRATION-20260930、revision：3。
- 原依頼（認証済みtask context、message IDは非公開）：

```text
結論は、まだ一気通貫で整っていません。確認したコードに、重要な不具合4件・軽微な不整合2件が残っています。
これは解決して欲しいのと、

今回は確認のみで、コード・本番DB・実申込・実返信は変更していません。2人の問い合わせがすべて解決できる状態とは、まだ言えません。
断定できる状態まで進めて
```

- canonical化v1：UTF-8・LF、上記コード枠内の本文、末尾改行なし。source SHA-256：`c30cc842b960067ffc7d8d0efcdaf5f55a03934498f7bf44bed1815605641f44`。
- ruleset：r43、manifest SHA-256：`c3e29919a7d0f718a108f9da78873cbfeb5fa1479b2596be5bba0f98dd913b76`。manifest・構成の照合値は実行時に再確認し、異なる値を使わない。
- 開始snapshot：`cebffef8997fe1387455d8aee6e6ea2538d48078`、既存checkoutと未commit変更を保持する。既存merged PRを更新可能とは扱わず、現在のbranchと公開先を再照合する。
- 成果物：6件の修正、直接影響範囲の回帰検証、独立レビュー、最新SHAの必須CI、本番反映と安全な変更対象確認。既存C01〜C08と品質受入条件を継承する。
- risk：local編集・隔離検証はSTANDARD_LOCAL。認証・店舗選択・返信の変更単位gateを実施する。本番migration、実送信、実データ変更は効果別の別nodeとして安全条件を固定する。
- 制約：決済・Stripe・キャンセル待ち、保留中のGoogleカレンダー時差・LINE解除は対象外。1ownerアカウント1店舗と公開準備条件を勝手に変更しない。実顧客への返信・実店舗統合は検証と分離し個別承認なしでは実行しない。新規費用の上限0円。

| ID | 原依頼との対応・合格条件 | 変更対象 | 必須反証・証拠 |
|---|---|---|---|
| F01 | 受付メールから原申込を失わず引継ぎ、確認情報不足で新規施設を作らない | outboxメール、onboarding | URL一致、別タブ・破損・期限切れ・storage利用不能ではsetup未呼出し、正常引継ぎとV1維持 |
| F02 | 受付で認めた文字数の情報を管理画面でも保存できる | 共有validation、settings APIと画面 | 上限・上限超過、全項目保存、既存必須・公開gate維持 |
| F03 | 複数所属で管理する店舗を明示的に選び、別店舗を誤編集しない | settings、photos、関連管理導線 | 権限付き選択、未所属ID拒否、店舗変更時の旧データ除去、選択中の操作固定 |
| F04 | 返信結果不明を二重送信なしで照合・復旧できる | 返信履歴・送信・照合・管理表示 | envelope不変、provider受理ID保持、DB失敗・競合・再実行、証拠不足をunknown保持、23時間後に無条件再送しない |
| F05 | 返信で対応中へ戻す際の解決日時を整合させる | reply API | resolved_atを同時に解除、DB失敗と再試行の検証 |
| F06 | 無効化時の既発行受付照会を文書でも正しく説明する | project文書 | prepare停止と既発行status照会のテスト・実装照合 |

F04では照合APIから送信せず、provider記録を対象operationへ厳密に紐付ける。ID欠損、404、一覧不在、時間超過、後続4xxは既存unknown解除の証拠にしない。受理と配達を区別し、競合する照合・送信応答で確定状態をunknownへ戻さない。旧pendingの証拠不足は履歴削除・架空日時・新operationで解除しない。

| 機構判定node | 完成判定に必要な照合・対応 | 現在の扱い |
|---|---|---|
| G01 重複統合 | 別申込の同店舗を安全に特定し、既存の運営復旧手段と原子的な関連付けの有無を確認する | 未判定、機構完成のblocking node。実店舗の自動統合は承認なしで実施しない |
| G02 無料掲載・複数店 | 1owner1店舗・admin複数所属・公開条件から正式手順を確定し、掲載専用公開の要否を経営方針と照合する | 既存仕様を保持、必要な方針判定は別gate |
| G03 申込タブ喪失・期限切れ | 再申込を勧めず、本人確認後の原申込回復に必要な運営導線と証拠を確認する | 未判定、機構完成のblocking node |
| U01 営業時間 | 自由文を無断で既定の予約営業時間に置換せず、保存・表示・予約利用の境界を検証する | 直接影響範囲の技術判定と回帰検証を必須とする |
| G04 本番実動作 | 安全な読取と隔離E2Eを分け、外部配達など検証できない部分はblocking unknownとして扱う | 6件のコード修正だけで機構完成としない |

完了条件：各行の証拠、最新SHAのlint・型・coverage・Contract・build・対象E2E・security・独立レビュー、必要なmigration実体と履歴・merge・deploy・health・変更対象動作を満たすこと。未判定の申込回復、重複統合、掲載のみの公開方針、返信の既存unknownを正常又は解消済みへ置換しない。機構の合格と実顧客案件の解決は別々に報告する。

## 固定範囲

- GOAL ID：CARELINK-CUSTOMER-REGISTRATION-20260930、revision：2。
- 原依頼：現在の認証済みtask contextの「そのエラーを全部進めて」。直前の2人の掲載申込・受付・公開・複数店舗・返信の調査結果を実装対象へ引き継ぐ。message IDは公開されていないため捏造しない。
- 原依頼のcanonical化：UTF-8、引用の括弧と末尾改行を除くexact text。SHA-256：`56c0a0b17a2d7d9c5b674f82e3a570dbe8151f6c8cc08af35b5967886913b793`。
- 適用規則：user-level入口から解決したr41。manifest SHA-256：`41983e33d92bfd64a85ea870b9b2e9117ca3b163c9b6f61d0024b2354d02481d`。同一bundleのlocal/remote Git・品質・準備・副作用・実機契約を読了・hash照合。
- 作業先：既存PR #642のcheckoutとbranchを維持。未適用migrationと既存修正を破棄しない。
- 対象：入力エラーの案内、受付結果不明時の重複防止、原子的な受付引継ぎ、運営問い合わせの認可と返信、無料掲載の案内、DB・型・CI・本番反映の整合。
- 対象外：決済・Stripe・キャンセル待ち、保留中のGoogleカレンダー時差・LINE解除、無関係な全体監査。顧客の申告内容を架空の申込データとして補完しない。
- 費用：新規有料契約、従量課金resourceは作成しない。
- 読取・local実装は続行する。実メール送信・本番DB変更は共通副作用契約の実在する承認・実行・照合能力を確認してから実施する。

## 要求から検証への追跡

| ID | 要求 | 実装・根拠 | 必須検証 | 完了証拠 |
|---|---|---|---|---|
| C01 | 不正入力の箇所を示し、入力を保持する | RegisterForm、salon-field-errors、salons API | 項目別400、壊れた応答、前stepへの移動、画像保全 | 対象unit・E2Eとdeploy後の同経路 |
| C02 | 受付番号は受理確認後だけ表示する | salon-registration-browser、intent/status/submit API | timeout、再読込、同一intent再実行、並行要求、権限拒否 | DB RPC・実API・E2E |
| C03 | 受付を本人の店舗へ安全に引き継ぐ | setup_facility_from_registration migration | 別人claim拒否、再実行、rollback、既存membership | 隔離DBテスト、schema・履歴一致 |
| C04 | 運営者が施設所有なしで問い合わせに入る | platform-support-path、middleware、admin layout | 匿名拒否、厳密なDBロール、DB失敗、隣接path拒否、API別認可 | unit、独立review、E2E |
| C05 | 返信の成否不明で二重送信しない | contact_reply_idempotency migration、reply API | 同一operation、本文競合、予約失敗、provider受理後DB失敗 | unit・index・本番履歴照合。実送信は個別承認 |
| C06 | 無料掲載の範囲、受付と公開、複数店の現行手順を説明する | 登録・完了画面、one_owner_per_user、publish gate | 文言と実装の一致、有料契約が登録処理へ混入しないこと | unit、現行方針の確認 |
| C07 | 最新版の必須CIから本番まで整合させる | PR #642、types、schema、migration履歴 | lint、型、coverage、Contract、build、E2E、security、独立review | 最新SHAの成功、merge、deploy SHA、health、対象動作 |
| C08 | 欠損profileから運営権限を自己付与できない | profile_insert_privilege_guard migration、既存RLS・UPDATEガード | 昇格拒否、別人拒否、正常回復、signup、service作成、正常編集、再適用 | 隔離DB、独立review、PG17 CI、本番schema・履歴 |

## 品質受入条件

| 適用項目 | 合格条件・証拠 |
|---|---|
| 事業・利用者価値／UX | 無料掲載の契約条件を変えず、入力保持・項目別エラー・受付結果の照合・再送判断・運営導線をunitとE2Eで確認 |
| 正確性／異常時／信頼性 | 成否不明を成功扱いせず、重複・競合・rollback・権限拒否を実DBとAPIで検証 |
| security／privacy | 運営権限をDBで厳密確認し、自己昇格を禁止。顧客の実値を差分・証拠・PRへ載せず、最新依存のhigh/criticalを0件にする |
| 運用復旧／保守性 | migration実体と履歴、生成型、fingerprint、最新CI、deployを照合。23時間超の返信結果不明は送信済み／未送信の外部証拠なしで解除しない |
| 性能／費用 | 権限照合はsupport対象pathに限定。既存pagination・bounded検索を維持し、追加有料resourceを作らない |
| 法務／brand／既存方針 | 料金・契約を創作しない。受付と公開、1ownerアカウント1店舗の現行制約を明示し、実顧客宛てメールは個別承認と送信照合を必要とする |

## 経営判断と技術不明点の区別

現行migrationは1アカウント1owner施設を明示し、店舗ごとに別owner accountという方針を持つ。複数ownerへ変更する場合は経営判断が必要であり、unique indexだけを削除して権限・表示・通知の誤紐付けを増やさない。adminの複数所属は既存許可だが、登録フォームから自動で付与されない。

無料掲載とネット予約の準備条件は別の概念だが、現在の公開gateはメニュー・写真・スタッフ・所在地を要求する。架空のメニュー・スタッフでgateを通さない。掲載専用モードを設ける場合は公開・予約の境界を設計・検証し、単なるgate削除で対応しない。

## revision 2時点の事実と未完了（過去の記録）

- Git共通契約はr41の同一bundleを解決済み。以前の「Git契約が読めない」を現在の停止理由にしない。
- origin/mainの`ed22894f`を既存branchへ統合済み。登録画面のfont競合は、外部font取得不要の同梱fontとPRの登録改善を保持して解消。
- 静的Contractを実行し、salonsの2列、salon_submission_photos、prepare_salon_photo、setup_facility_from_registrationの型定義不足で3検査失敗を確認。許可リスト追加・型の架空補完で隠さない。
- 本番のintent・photo・setup RPC・返信unique indexはこのturnの読取で未存在。個人情報は取得・転記しない。
- 対象顧客の個別返信と実掲載は未完了。申込受理・公開・返信送達をコード修正だけで解決済みと扱わない。
- 本番DDL、merge、deployは未実施。最新結果は後続の証拠欄へ追記する。

## 2026年9月30日の実行証拠

- production build：Node 24・秘密情報なしのlocal設定で成功。合成anon keyのため公開DB読取のfallback logが出ており、本番DB動作成功の証拠ではない。
- 全unit：依存更新と最終Link修正後も420スイート・8,587テスト成功。8813/8813 branches、100％。
- 権限境界の負の対照：新middleware分岐を一時無効化すると対応3テストが失敗。復元後15テスト成功、source hash一致。故意の欠陥は残していない。
- PG14のtask専用Unix socket・外部接続なしの隔離DB：旧UPDATE専用ガードでは自身の欠損profileへのINSERT昇格が成立。新migration適用後、RLS・signup・UPDATE・service_role・正常回復のfixture成功、再適用成功。PG17の全migration検証の代わりにはしない。
- 独立review：INSERTガードとsupport pathの認可を反証。E2Eのリンク名P2を修正し、再レビューで対象差分の未解決P0〜P3を未検出。実行していないE2Eを成功扱いしない。
- 開発依存のhigh脆弱性：brace-expansion 2.1.4を2.1.7へ更新。lock・overrideの最小差分、正常・悪意あるbrace入力検査成功。全依存npm auditは0件。公式根拠：https://github.com/advisories/GHSA-qhr7-859c-m2p7 。
- PG17全migration適用・生成はGitHub `schema-fingerprint` run `36678721179`、head `e761e2b09662b947e59551b0cbfed4d084edfb30` で成功。比較gateは新ガードの関数grant・関数定義・triggerの3追加を正しく検知して失敗。artifact `11080856781` の生成JSONをそのまま反映し、旧2587項目→2590項目、削除0、PG17 markerを照合。生成物SHA-256：`8bfc93c6bc82fc64a9001069cfa5f45bcd30c376b0d36003c121b9bc156e24f0`。比較後の各DB fixtureと実E2Eの成功は別gateとして確認する。
- ローカルDockerはcontainer作成・execともIO errorで使用不能。無関係な稼働containerを再起動・削除せず、provider-hosted隔離CIを代替経路にした。
- GitHub CI run `36678721166`、head `e761e2b09662b947e59551b0cbfed4d084edfb30`：隔離SupabaseのAPI Contractは16件・skipなしで成功。production buildとHTTPS E2Eは301件成功。施設所属なしの運営担当者の画面到達・権限失効を含む。全体runは本番由来の型定義不足によるContract失敗のため不合格であり、本番動作・実メール送達を保証しない。
- HIGH_RISK本番DDLと実送信：接続済みSupabase connectorは読取可能だが、保護された承認binding・実行台帳・結果不明時の照合を持つ実在経路は未解決。通常shell／SQL Editorへ格下げしない。通常local・PR・CIは継続する。

## 完了条件

C01〜C08の全必須検証が最新変更へ成功し、経営判断が結果を左右する未決事項、必要な本番schema・履歴照合、deploy後確認が解消された場合だけ完了とする。隔離test、provider受理、本番反映、受信箱到達を区別する。無関係なデータを書き換えない。

## 今回限定の本番migration実行計画

- 認可源：現在の認証済みtask contextでの神原さんのexact text「今回だけ、Supabase公式のmigration機能と事前・事後確認を使う方法を認める」。共通rulesetの恒久改訂ではなく、本タスクの非破壊migrationに限る後続指示。既存の専用台帳・gateway不足だけではこの限定経路を停止しない。破壊的操作、費用発生、顧客への実送信、経営方針変更は含めない。
- 実行先：CareLink production、project ref `xzafxiupbflvgbarrihe`。既存の認証済みSupabase公式connectorの`apply_migration`を使い、SQL Editorの直接DDL、履歴INSERT、`migration repair`は使わない。
- 対象：未履歴のWebhook delivery開始ガード、profile INSERT昇格ガード、登録intent、能力期限、写真manifest、公開所在地制約、原子的setup、review revision、返信pending unique index。既履歴の20260919000001・20260921000001とdeferred Storage cutoverは対象外。
- 依存順：登録intent→能力期限→写真manifest→原子的setupを維持。profileガードと返信indexは独立。既存列・indexのWebhookガードは実定義と一致する場合だけ冪等な適用を記録する。
- 変更効果：テーブル・列・制約・index・関数・trigger・grantの追加又は限定置換。既存業務行のUPDATE/DELETE、実送信、顧客の代行申込、公開化は行わない。新規resource・有料プランを作成しない。
- 事前条件：所在地はmigrationと同じUnicode空白判定、welcomeは全statusのpayloadとtarget、登録通知のlegacy型、返信pending重複を件数のみ確認する。今回の事前結果は全て0件。PostgreSQL 17.6で接続可能。Webhook開始列はtimestamptz、indexはclaimed_at・processingかつ開始未記録predicateに一致。
- 初回適用前の安全修正：未適用5本の最上位BEGIN/COMMITだけを除去し、公式migration transactionに履歴とDDLの確定を委ねる。関数内のBEGIN/ENDや業務処理は変更しない。Supabase公式docsはmigration失敗時rollbackを記載する。SQL内COMMITで外側transactionを先行確定させる経路を作らない。
- 履歴整合：公式機能が発行するversionを実際の履歴から取得する。未共有適用の候補だけをそのversionへ一対一で改名し、旧名・新名・適用SQLのSHA-256を記録する。適用済み原票は不変。既存OOB定義は未履歴原票の共有適用状況も確認し、不明なら原票を変更せずforward reconciliationに分離する。
- 事後条件：履歴の記録SQLと適用SQL、列型、index定義・validity、RLS、RPC signature・service許可・anon/authenticated拒否、trigger、制約を照合。所在地の違反0とconvalidatedは別に記録する。NOT VALIDをvalidate済みと扱わない。
- 所在地の完結条件：既存行の違反0を再照合した後、追加forward migrationでVALIDATE CONSTRAINTを実行しconvalidated=trueを確認する。既適用のNOT VALID原票は変更しない。validationは行を修復・公開・削除せず、違反があれば公式transactionを失敗させる。
- 成否不明：同じmigrationを再送せず、履歴と実定義を読取確認する。履歴欠落・部分状態・並行変更があれば依存する適用を止め、証拠を保持する。
- 復旧：失敗時は公式transaction rollback、成功後は追加した業務データを消さずforward-fixで復旧する。旧本番consumerを維持し、v2機能を無条件で有効化しない。新テーブルのDROPや履歴削除をrollback手段にしない。
- 反映後：本番から公式生成した型を反映し、最新SHAのContract・全必須CI・独立レビュー後にPR #642を保護条件内でmerge。deploy済みSHA・health・対象read-only動作を確認する。顧客への返信・掲載完了は別証拠を要する。

## revision 4の検証台帳（2026年10月1日）

これはコード修正・隔離検証と本番状態を分けた記録。未commitの変更についてcommit SHAのCI成功はまだ存在しない。

| node | 現在の証拠 | 未完了の確認 |
|---|---|---|
| F01〜F06 | 引継ぎfail-closed、入力上限、権限付き店舗選択、返信envelope不変・結果不明の再送禁止・照合、解決日時、無効化時status仕様をlocal修正 | 最新CI、変更対象の本番確認 |
| G01 重複関連付け | 専用不変台帳／service-only RPC／platform権限／CAS／同一店舗照合／全setup mode。PG17 fixture、20要求の1成功19replay、claim競合、独立反証成功 | 新migration適用と履歴、本番動作、最新CIのE2E |
| G02 掲載／予約 | 掲載条件と予約条件をUI/API/DBで分離。全7曜日の確認済み営業時間、公開メニュー、写真、有効スタッフ、原子的全menu保存。管理予約を維持。実DBの正常・拒否・境界・回帰検証成功 | 複数owner方針の回答、正式な同意付き複数店舗管理導線、最新CI・本番確認 |
| G03 原申込復旧 | 確認済み現在Authメール／不変72hgrant／HttpOnly cookie／bounded一覧／原写真保持／明示setup。PG17 fixture・Auth変更／expiry lock競合成功。復旧画面17テスト成功 | 新migration適用と履歴、最新CIの実Auth／ブラウザーE2E、本番確認 |
| U01 営業時間 | 架空の既定営業時間を保存せず、営業時間欠損のネット予約をUI/API/DBで拒否。掲載のみと管理予約を維持 | 最新CI・本番確認 |
| G04 反映・一気通貫 | isolated CI専用の実Auth→復旧→作成→掲載のみ、およびplatform関連付け→本人linkedのE2Eを追加。静的Contract 17件、236migrationの実PG17再構築と2,648項目fingerprint一致、全rollback fixture成功 | 新E2Eは未実行。local Dockerが使用不能で既存のGitHub隔離CI経路を必要とする。新4migrationの本番schema／履歴、公開PR・merge／deployは未完了 |

- 最新全体再検証前の測定：435スイート・8,928テスト、9049/9049 branches（100％）。その後Axiosと復旧画面を変更したため、この値を最新合格として流用しない。変更後の全体検査を再実行中。
- Axiosはtransitiveの1.18.1から1.20.0へoverride／lock最小差分で更新。実node_modulesのversion一致、`npm audit --audit-level=high`のcritical/highを含む全0件を確認。LINE解除の保留方針は変更していない。
- ESLintは最新1,041ファイル、error 0、warning 4。既存React Compiler debt baseline 4と一致。新規警告はルール無効化・baseline増加なしで解消。
- 復旧画面のStrictMode中の破棄済み401／失敗が新しい表示・遷移へ反映されないこと、およびunmount時の通信abortを追加検証。17件成功。
- 負の対照：隔離copyで`linked`結果を拒否すると45件中1件が失敗。復元後45件成功、変更前後source SHA一致。元workspaceを故意に壊していない。
- GitHub読取再照合：PR #656はMERGED、headは開始HEADと一致。mainは`fc29c6788fb3bcf3a7ddbb62f0e3ea0c126b5da7`、保護あり、repositoryはPUBLIC。merged PRを更新可能とは扱わず、新しい変更の公開先を確定する。
- 本番のmetadata-only読取：PG17.6。`salon_registration_recovery_grants`、`salon_duplicate_links`、返信`delivery_envelope`、`facility_booking_ready(uuid)`は未存在。顧客データは取得していない。新4migrationは未適用であり、本番で解消済みとは報告しない。
- 本番の旧限定migration承認を新4migrationや公開PR・deployの承認へ無断拡張しない。新しい限定公式経路と複数店舗方針を確認中。共通Git契約はr43で解決済みであり、「契約が読めない」は現在の理由ではない。
