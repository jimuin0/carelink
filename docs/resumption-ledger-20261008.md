# 2026年10月8日 再開・再判定台帳

全体は未完了。評価基準のmainは `1801e66fdf33b6a09491c207f35905d0eacadae5`、今回の変更はPR #663の `d6a6a721b220bd12da57e90f54aafa73b5311fe9` を含む。この文書の「今回修正」は本番反映前のコード・ローカル検証を指す。

## 新Macと証拠の範囲

旧checkoutと復元済みの未commit変更は保全し、独立worktreeと専用node_modulesで再開した。Vercel設定・CIに合わせNode 24.21.0を使用。npm ci、以前失敗したE2E時間予算・minimatch互換12件、今回の関連85件、型検査、lint、全体単体9,573件・464suite、分岐9,410/9,410＝100%、production buildが成功した。lintの既存warningは4件。buildは合成キーを使い、本番DBへ接続していない。

Next 16.3.6→16.3.8、sharp 0.35.4→0.35.5、source-map-js 1.2.1→1.2.2へ限定更新し、2026年10月8日のnpm auditはhigh/critical各0、moderate19。moderateは未解消として残す。根拠は [Next修正版](https://github.com/advisories/GHSA-cjq9-62q9-8jv4)、[sharp修正版](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)、[source-map-js修正版](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)。脆弱性情報は更新されるため、過去のaudit成功を現状へ流用しない。

原票索引の503ラベル（430＋73）と355断片を858レコードとして非公開保存した。これは不具合858件という意味ではない。全原票の現在の判定は未照合のまま保持し、下記21項目の限定再判定と混同しない。歴史的索引が記録した151source中68sourceの取得不能も、今回復元済みとは認定していない。実顧客の情報を公開リポジトリへ転記しない。

## 過去PR

| PR | 再判定 |
|---|---|
| #661 | マージ済み。過去の未マージ記録を現状としない |
| #662 | マージ済み。main CI 37110697542成功、単体9,559件・branches100%、隔離実API17件、E2E324件・flaky/skip0。本番healthのversion1801e66と一致 |
| #663 | Draft。依存互換とStrykerテスト環境修正のCI 37150244629は成功。今回の変更を追加した後の固定SHAでCIを再確認する。旧SHAの合格を追加変更の合格にしない |
| #647 / #651 | contactのtraffic_source保存・Slack本文は現mainに存在。提案をそのまま再マージする必要はない。PRの閉鎖は未実施 |
| #646 | テスト整形の提案。現機能の修正要否とは別に差分精査を残す |
| #632 / #640 / #641 | 古い基準の提案。ブランチ全体を再マージせず、原指摘・現main・テスト単位で再判定。全提案の照合は未完了 |
| #626〜#630 | 依存更新提案は最新lockとの差分・互換性で再判定が必要。Stripe更新は保留範囲 |

## 直近の原指摘21項目

参照IDは旧 `carelink-current-unresolved-20260930.md` のR01〜R21を維持する。原指摘の失敗条件を現mainで読み取り、同じファイル名だけで修正済みとは判定していない。未修正は本番で実害を観測したという意味ではない。

| ID | 現在の判定 | 現コード・残る条件 |
|---|---|---|
| R01 | 修正済み・実配送は別確認 | `api/admin/inquiries/[id]/reply` のreconcile、`inquiry-reply-delivery`、正式migrationでprovider IDと封筒を保存。本文を再送せず受理照合する回帰あり |
| R02 | 修正済み | `create_online_booking_atomic` 内で全menu_ids保存。同transactionで予約を作成。一般roleの直接EXECUTEは本番でも拒否 |
| R03 | 未修正 | `api/booking` 初回user_points SELECTのerrorを捨て、残高不足へ変換 |
| R04 | 未修正 | `api/booking` 予約・ポイント控除・補償が別I/O。補償失敗の原子化／永続復旧が必要 |
| R05 | 未修正 | `api/booking/[id]/cancel` の返還が取消CAS後。返還失敗の安全な回復が不足 |
| R06 | 一部修正 | 来店実績はbooking_visit_atomicで状態変更と同時保存。本番migration記録あり。`booking-completion` のポイント保存失敗・付与済み相当の返却は残る |
| R07 | 未修正 | `api/booking` DATEのvalid_untilをISO timestampと比較。JST業務日と期限境界の統一が必要 |
| R08 | 未修正 | `api/admin/moderation/[id]` 却下後のreview非表示失敗でも成功応答。原子化／安全な再試行が必要 |
| R09 | 未修正 | `api/admin/staff` 勤務表失敗後の補償DELETEの結果未検査。作成の原子化が必要 |
| R10 | 未修正 | `admin/photos` 削除時にmain_photo_urlを解除しない。metadata失敗後の保存物の照合も必要 |
| R11 | 今回修正・未配信 | Push失効削除をuser_id＋送信したendpoint＋鍵に限定。新登録を巻き込む競合回帰あり |
| R12 | 未修正 | `cron/review-request` claimの返却errorを0件扱い。正常なCAS負けと障害を分ける必要 |
| R13 | 未修正 | `cron/onboarding-followup` profile SELECTのerrorを連絡先なしとしてclaim維持 |
| R14 | 未修正 | `cron/daily-summary` 取得失敗のfailed:0とbulkのerror未検査。監視正常を配送正常としない |
| R15 | 未修正 | `cron/customer-segment` メール受理後marker保存失敗の重複再送防止が不足 |
| R16 | 修正済み | `admin/bookings/[id]` 保存成功と配達完了を区別する表示・回帰テストあり |
| R17 | 今回修正・未配信 | feature flagsのHTTP／通信／不正応答を表示。正常0件と区別し再試行可 |
| R18 | 今回修正・未配信 | 保存はtry/catch/finally。応答喪失後に現在値を再取得し、読取失敗なら旧値で変更させない |
| R19 | 未修正 | `facility/InquiryForm` clientの空白・名前最大長とAPI validationが不一致 |
| R20 | 今回修正・未配信 | 勤務表退避の返却errorならDELETE／INSERT前に停止。dataとerror同時返却も拒否。全置換の原子化／復元失敗は別途残る |
| R21 | 未修正 | LIFF共通helperとcouponsにprofile SELECT障害を未登録へ変換する経路が残る |

分類は既存修正3、一部修正1、今回修正4、未修正13。全原票503ラベルをこの21項目に吸収したとは認定しない。

## 本番の読取確認と残件1〜8

2026年10月8日04:19 UTCの読取transactionで、Supabase projectはACTIVE_HEALTHY、public table/viewは112、migration履歴138件、対象予約RPCはanon/authenticatedのEXECUTE不可・service_role許可。全localファイル名との履歴一致や全スキーマ無差分はこの件数だけで認定しない。

直近8日のcron_logsはsuccess/skippedのみでerror0、CareLinkのpg_cronジョブ0。external contact_repliesのsent_at未確定は0件。結果不明を正常へ書き換えたり、再送したりしていない。Render providerのログ取得はworkspace指定確認待ち。上記のDB記録だけで各実行のprovider帰属・個別メール到達を断定しない。

| 残件 | 現在の境界 |
|---|---|
| 1 店舗選択 / 2 本日の予約 | #662でコード・CI・配信完了。認証済み本人操作の本番smokeは未確認 |
| 3 Storage | carelink-uploadsのanon INSERT許可が現存、bucket byte上限null、許可MIMEは画像4種。旧フォーム保全は配信済みだが旧タブの回収、global上限、正式切替は未完了。deferred SQLを本番へ直接実行しない |
| 4 SMTP / Google | 本人メール→リンク→ログインとGoogle callbackの実成功証拠不足。本人ログイン・対象限定が必要 |
| 5 本番一気通貫 | production healthだけでは完了しない。合成対象・公開副作用・後始末を固定してから実施 |
| 6 Cron / 通知 | 今回DB実行記録を更新。Render一次ログとprovider送達確認は残る。masked failureのR12〜R15も残る |
| 7 規約 / 退会 | 非公開化・保持と「削除」の説明の整合、目的・期間の判断が残る。実データ削除は行わない |
| 8 最終台帳 / 監査 | 過去状態を訂正し、858原記録の索引を保全。個別照合・未取得source・最終CI／配信証拠は残る |

支払い・Stripe・キャンセル待ち・Googleカレンダー時差・LINE解除、実顧客への返信・代理掲載は既存の保留を維持。全コード監査の飽和、未修正ゼロ、全体完了を認定していない。
