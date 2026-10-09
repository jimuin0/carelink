# 2026年10月8日 再開・再判定台帳

**全体は未完了。** 本番確認済みの基準はPR #664のmerge `a46f5e18d68ba6cb032d76f85194b30d15f95c03`。今回の追加修正は、以下のローカル検証を終えた時点の記録であり、まだ本番適用・配信成功を示さない。

## 新Macと原監査資料

独立した作業環境と専用node_modules・Node 24.21.0・Docker/Supabaseを用意し、旧checkout・復元済み未commit変更は保全した。新Macの関連1,313文書と151原票の保存済みhashを照合した結果は2一致・149未回収。さらにCareLinkの旧セッション19件とiCloudの関連文書を調べたが、新しい原票一致は得られなかった。旧Macの一時ディレクトリにあった149原票は、元ファイルまたはbackupの回収が必要である。 旧セッションの復元は作業再開の前提にしない。未回収でも、保存済みコード・Git・PR・DB・運用ログを根拠に現行コードの再監査を進める。元の全文との完全照合はできないため、索引を保全して「元資料照合不能」を修正状態と別に記録する。旧Macを確認できないことだけで永久消失と断定しない。

503ラベルと355断片の858記録は非公開の索引として保全した。858件の不具合や、全文監査の完了を意味しない。原票の内容を推測して補完せず、未照合のまま保持する。実顧客情報を公開Gitへ転記しない。

## 過去PRの再判定

| PR | 確認した結果 |
|---|---|
| #661 / #662 | マージ済み。#662のmain CI 37110697542で単体9,559件、分岐100%、隔離実API17件、E2E324件、flaky/skip0。本番version1801e66を確認 |
| #663 | CI 37729102345、PG17 37729102316成功後にmerge117e42a。単体9,573件、分岐100%、実API17件、E2E324件・flaky/skip0。本番200・healthy・version一致 |
| #664 | PR head b85d2084のCI 37734023083・PG17 37734023084成功。merge a46f5e1のmain CI37735593929・PG17 37735594002も成功。単体9,601件、分岐100%、実API17件、E2E324件・unexpected/flaky/skipped各0。Production deployment6928478917成功、06:21 UTCの本番200・healthy・version a46f5e1 |
| #665 | head12a395d3のCI37871000634・PG17 37871000612成功、HTTPS E2E348件・unexpected/flaky/skipped各0。レビューで判明した退会前の共有fenceと未復元下書きの自動上書きを追加修正し、480suite/9956test・分岐9758/9758・型・lint負債3件を再確認。head2cf83a21の全CI37881907492・PG17 37881907456成功、HTTPS E2E348件・unexpected/flaky/skipped各0。原本保護・復元後のrevision競合も実Chromium/Safari18件・retry0で確認。本番の正式DB適用・配信は未完了 |
| #647 / #651 | 全差分を現mainと照合し、traffic_source保存とSlack本文の変更は現存。再マージ不要。PRの閉鎖は未実施 |
| #646 | 追加された流入元テスト3件のTypeScript構文木も現mainと一致。単なる整形だけの提案ではないが、再マージ不要。PRの閉鎖は未実施 |
| #632 / #640 / #641 | 全差分から失敗条件を再判定。プロフィール失敗、予約receipt、レビュー写真、Threads、Auth待機、配信の整合などを個別修正。元PRの全未適用を不具合とは数えない |
| #626〜#630 | 全9file差分・36hunkの照合完了。4件は未採用の依存更新、Stripe1件は保留。版の差だけから新たな重大不具合を認定しない。同一package/lockの既存CIはhigh/critical0・moderate19 |

## 直近21項目

IDは旧 `carelink-current-unresolved-20260930.md` のR01〜R21を維持する。「追加修正」はコードと隔離検証の状態であり、本番反映とは区別する。

| ID | 現在の判定 | 根拠・残る境界 |
|---|---|---|
| R01 | 既存修正 | inquiry返信の永続ID・封筒とprovider受理照合。実返信の到達は別確認 |
| R02 | 既存修正 | 予約RPC内で全menu_idsを同transactionに保存。一般roleの直接EXECUTEは拒否 |
| R03 | #664配信済み | ポイント残高SELECT障害は予約作成前に500 |
| R04 / R05 / R06 | 追加修正 | 予約作成・控除、取消・返還、完了・付与／取消をDBの同transactionへ移動。競合・rollback・正確な再試行・旧consumer互換を検証。曖昧な旧台帳を推測して変更しない |
| R07 | #664配信済み | DATEの期限と開始日をJST暦日に統一、日境界を検証 |
| R08 | 追加修正 | 却下・review非表示を原子化。確認したstatusとreviewed_atのCAS、同じactor・判断・本文の再試行、権限変更を検証。直接queue書込みも閉じる |
| R09 | 追加修正 | staffと初期7日勤務表を同transactionに保存。UUIDと入力hashの永続receiptで応答喪失後も照合 |
| R10 | 追加修正 | 写真metadata削除と最後の参照に対応するmain_photo_url解除を原子化。Storage実ファイルの削除は含まない |
| R11 | #663配信済み | Push失効削除は送信したendpointと鍵に限定 |
| R12 / R13 / R14 | #664配信済み | 通知claim・profile読取・batch取得の障害を成功扱いせず、errorとして記録 |
| R15 | 追加修正 | クーポンごとに不変の配送IDと封筒を保存し、既存webhook workerへ渡す。provider受理とmarkerを同transactionで保存。旧null markerは結果不明として保留。受理列のrenameで旧consumerの安全なfallbackへ誘導し、operationがない新at_risk INSERTをcommit前に拒否。実RESTで旧直接INSERT拒否・新RPC成功を検証。既に開始した旧送信を遡って取消す保証はしない |
| R16 | 既存修正 | 予約保存と配達完了を区別する画面・回帰あり |
| R17 / R18 | #663配信済み | flagsの読取・保存・応答喪失を表示、再読取失敗時は旧値で変更しない |
| R19 | #664配信済み | form/APIの共通schemaで入力上限・trimを一致 |
| R20 | #663配信済み＋追加修正 | 既存の読取障害停止に加え、全週勤務表の置換・例外日・強制変更を原子化。操作receiptと再試行、予約との実ロック競合を検証 |
| R21 | #664配信済み | LIFFの未連携とDB障害を区別、障害は500 |

追加でV1 APIの `*` scopeによる別施設アクセスを拒否した。施設の範囲は操作scopeと独立に確認する。ログイン画面もSDKの522/500/結果不明を「パスワード違い」と表示しない。

## Storage・退会処理

Storageの容量とprofile削除後の古いJWTからの書込みを制限するmigrationを用意した。匿名V1経路を保った容量設定と、匿名INSERTを閉じる全面切替は別段階である。新consumerは実bucket設定を確認し、本人が選ぶ端末下書き保存・元画像backup・同じ申込の結果照合を備える。旧V1の未送信入力を遠隔復元できるとは説明しない。[切替計画](salon-storage-cutover-20261008.md)の影響判断とDashboardのglobal上限確認が未完了。

退会の17項目の整理をAuth削除と同transactionへ移し、失敗時の巻戻しと最後のowner判定を検証した。APIはDB readinessが確認できなければAuth削除前に停止する。規約・privacy・画面は、アカウント等の削除、業務記録の保持、最後のowner退会時の公開ページ／オンライン予約の停止を区別する。Storage画像の物理消去を約束せず、保存期間の新方針や無断の実データ削除は導入しない。

端末の削除cookie・共有世代・IndexedDB/sessionStorageの読戻し確認で、別タブ・削除失敗・新しい画面での古い予約下書き復元を防ぐ。すでに読み込まれた任意の旧JavaScriptのメモリ消去は保証しない。

## 追加の再判定

PR #632の全差分を読み、プロフィール作成失敗をAuth登録成功として扱うcatch-allが残っていたため、既存metadata・ACLを維持して登録transactionの失敗へ戻す第7の正式migrationを追加した。ローカルの実Auth SDKで失敗時のAuth/profile残存0と正常OAuth metadataを確認。初回メール再送の60秒制限と無料掲載CTAも修正した。

#640/#641の照合では、予約の応答喪失後の再送、レビュー画像保存失敗、Threadsの結果不明送信、公開AIの共有費用上限などの追加差分が見つかった。現存・別方式解決・未対応・既存保留を区別して別途修正する。古い提案の全未適用を不具合と数えず、全提案済みとも扱わない。

## 2026年10月9日 追加修正の検証

作業先は `/Users/kam/Projects/carelink-final-followups-20261009`。以下はコード・隔離検証の状態であり、本番適用を示さない。

- 予約の固定UUIDとactor/HttpOnly guest scope、入力hashのDB receiptで、応答喪失・二重クリック・再読込後も同じ受付を照合する。操作の変更や別actorは拒否し、不明な受付を新しいUUIDで送らない。予約・各通知outboxは同transactionに保存する。
- 通知対象は全所属・設定・宛先と比較し、読取障害や集合変更では予約を部分受付しない。actor、弱い親ロック、所属、非キー親ロックの順で競合を検証。内容・権限が変わった作成通知は開始前に抑止する。
- 新配信にはdispatch version2の正式claimを必須化し、旧raw workerの取得・attempt消費を拒否する。producerもDB readinessを確認し、部分DDL中は受付を停止する。開始後の結果不明は自動再送しない。
- レビューの元画像・容量・MIME・実ownerを照合し、画像失敗で本文だけを送らない。結果不明は入力と受付fenceを保持する。Threadsも開始前の永続証明と公開済みの証拠を照合し、containerの準備完了だけを公開成功としない。
- ニュースレターは同一キャンペーンの固定operation・宛先別queueで受理／不明／抑止を区別し、配信停止を原子化。clientの任意メール購読書込みを閉じる。受付・配信停止・Auth削除の実競合を確認。
- LINEは両表で一致する本人確認済みの所有者だけを認め、自己編集profile・未確認リンク・email一致からログインを作らない。標準Supabase接続では作成できないAuth索引を除去し、信頼候補が複数なら選ばず停止する。外部Auth作成の厳密な1回保証や既存dataの推測統合は約束しない。
- Auth/reCAPTCHAの待機を制限し、障害で入力を消さない。ログイン・新規登録のSSR入力欄はhydration完了まで停止し、初期化による入力喪失を防ぐ。新しい登録は同意記録を保存し、旧フォームは同意なしの履歴を推測追加せず段階移行を維持する。
- AIは共有24時間quota、retention、bot proof、SDK再試行0と全応答deadlineを確認し、医療相談本文をログへ出さない。回答待ち中の次の入力を保持する。Blogの障害を404と扱わず、Calendar DELETEは削除証拠と同じ記録へのCASだけで解除する。時差の変更は保留。

全500suite・10,487test、分岐10,519/10,519＝100%。258 migrationのfresh PG17/C localeが一致しfingerprint2,942項目、34 SQL rollback fixtureが成功。標準ローカルSupabaseで同じmigration本文を検証し、公式CLIから型を生成（public119table/view）、隔離実API17件・静的契約17件、実ロック競合、Chromium/Safariの対象検証も確認した。追加段階の最終GitHub CI/全体HTTPS E2Eは別途確認する。

本番の基準は引き続きa46f5e18。第1段階PR #665の7本の正式migration要求はcancelledのため未適用を確認し、再開の本人確認待ち。第2段階の8本も未適用。旧OAuth/古いscheduler・pinned経路の停止とdrain、新workerの稼働確認は本番の実確認が必要で、新mainの配信だけで証明済みとはしない。

149原票の未回収を保全し、現行コードの独立した再監査として進める。原索引の全文照合・全コード監査の飽和・未修正ゼロ・全体完了は認定していない。

## 今回の検証と残る作業

全480suite・9,956test成功、測定対象の分岐9,758/9,758＝100%、型検査と静的migration契約17件が成功。PG17で250 migrationを新規再生しfingerprint2,778項目が一致。C locale一致と25 SQL fixtureも成功。失敗・競合・SDK権限・Chromium/Safariの対象確認は個別ログに保存した。head12a395d3の全体CI/PG17/HTTPS E2Eは成功。後続レビュー修正のCIと本番適用後の証拠はまだこのsnapshotに含まない。本番への正式migration要求はコネクターからcancelledを返したため未適用を確認し、直接DDLや履歴repairで迂回していない。

- 本番の最新SHAによるCI・PG17・HTTPS E2Eと正式migration履歴／実体照合。
- Supabase本人ログイン後のSMTP設定、本人メール→リンク→ログイン、Google→callbackの実成功。
- 認証済み店舗操作と本番一気通貫、Render一次ログ・provider受理／到達確認。
- Storage全面切替の影響判断、旧タブの入力保全、global上限確認。
- 149原票の回収と858索引の個別再判定、残る古いPR差分の照合。

npm auditは直近確認でhigh/critical各0、moderate19を未解消として残す。lintは既存warning3件。以前の10対象Strykerは1048mutantのSurvived/Timeout等0であり、今回の新SQLや対象外の全コードの検出保証ではない。新Macの並列Node SIGSEGVの原因も未確定で、今回の全体Jestは逐次実行した。

決済・Stripe・キャンセル待ち・Googleカレンダー時差・LINE解除、実顧客への返信・代理掲載は保留を維持。原票回収・全コード監査の飽和・未修正ゼロ・全体完了を認定していない。
