# 問い合わせに直結する登録修正の実行契約

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

## 現時点の事実と未完了

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
