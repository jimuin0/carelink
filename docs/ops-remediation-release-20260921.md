# CareLink 予約運用修正のリリース条件

## この変更の適用順

1. 本番に接続する前に、対象projectと適用済みmigrationを読取で照合する。
2. `20260916000001_webhook_retry_delivery_start_guard.sql` と `20260921000001_reminder_delivery_reconciliation.sql` の適用を確認する。後者を先に適用してからアプリをデプロイする。今回のローカル作業では適用していない。
3. `pending_booking_reminders(date)` の実DB契約、一般ユーザーの実行拒否、service roleの実行、予約日・種別・施設設定・利用権限の境界を隔離環境で確認する。
4. 最新commitのCI・buildを通し、認証済みの本番確認を行う。単体mockやSQL静的照合を本番疎通・送達確認の代わりにしない。

`migration-prod-drift.contract.test.ts` は実DBへ接続せず、migrationと生成型`database.types.ts`を比較する。RPC欠落という失敗表示だけでは、現在の本番DBへの未適用を確定できない。対象DBのmigration履歴・列・制約・索引・関数定義・実行権限を読取照合し、未適用なら適用して確認した後、同じ対象DBから型を正規再生成する。未確認のまま型を手で足したり許可リストへ追加して緑にしない。

本migrationはトランザクション単位の一回適用を前提とし、制約・索引の再作成は冪等ではない。既適用なら再実行せず定義一致を確認する。適用結果不明時もまず履歴と実定義を照合する。全体が一致しなければ、部分適用と決めつけて盲目的に再実行しない。

## 予約通知の状態

- `legacy`：旧実装のclaim。過去の送達を推測せず、自動再送しない。
- `claimed`：外部送信開始前。15分より古いclaimのみ回収可能。routeの最大実行時間は60秒。
- `delivering`：送信開始をDBへ保存済み。結果記録が不明なら自動再送しない。15分より古ければ継続警告する。
- `delivered`：providerの受理応答を確認した。受信者の受信箱へ到達したことまで保証する状態ではない。
- `uncertain`：通信障害・タイムアウト等。次回以降も警告し、providerログとの照合まで保持する。
- `closed`：既存のLINE恒久失敗分岐で、別の予定メールへ委ねたか利用可能な宛先がない状態。送達成功とは区別する。

未送信と確定した拒否はclaimを解放して次回試行を可能にする。送信開始前の予約を再読し、取消・日時・宛先などが変わっていれば送らない。送信開始後に利用者が予約を変更した場合、providerへ受理済みのメールを撤回できるという保証はしない。

候補RPCは既claimを除いた予約を返し、既送信の先頭5000予約が後続を占有する構造を解消する。明確な拒否が大量に継続する場合の再試行回数・優先順位は別途運用確認が必要。

## 結果不明の復旧

件数と状態を先に確認し、照合が必要な行だけを最小権限で調べる。送達の証拠なく`delivering`・`uncertain`・`legacy`の行を削除してはならない。送達済みなら状態だけを確定する。未送信だと確定したものだけ再試行対象へ戻す。これらの本番書込みは固定計画・承認・実行能力を確認してから行う。

## ロールバック

予約通知cronを止めてからアプリ版を戻す。追加列・RPC・claimは保持する。旧版cronは新しい送達状態を理解しないため、通知cronまで無条件に旧版へ戻して再開しない。結果不明claimを解放しないことを確認した互換版を使用する。データ削除によるロールバックは行わない。

## 退会の未決定事項

現在の退会はアカウント参照の解除と認証アカウントの削除であり、予約・問診・診療・顧客記録の完全消去を意味しない。公開privacy本文には、それぞれの保存期限・施設側記録との責任分界・本文匿名化の具体条件が定義されていない。これらは神原さんの方針確定が必要で、今回の修正で保存期間や不可逆削除を新設していない。

技術的には施設停止失敗時にAuth削除を止め、profilesとfacility_membersは既存のAuth FK CASCADEに委ねる。Auth削除失敗時の再実行情報を保持し、削除後の監査ログは削除済みuser_idを参照しない。業務記録の部分整理や退会と新規予約の厳密な並行排他まで単一トランザクションにした変更ではない。

## 完了に必要な未実施確認

- 新規migrationの本番適用後の契約照合。使い捨てPG17の候補抽出・ロール別呼出し・claim除外fixtureは`schema-fingerprint` CIで検証するが、本番への適用証拠や真の同時実行試験とは区別する。
- Supabase Auth・SMTP・Google OAuthの本番設定と、神原さん宛の実メール到達・確認リンク完了。
- 本番Cronの最新成功、結果不明警告の維持、既存保留行のprovider照合。
- 最新commitのCI・デプロイ後のhealth・登録/予約画面のE2E。

## 検証証拠と環境の区別

`9ddf18355d29d9fc6616eb76e0e3b1873a4b1739`のCI run `35615182688`では、Unit 373 suites・7541 tests、branches 8020/8020が成功し、E2Eは267 passed・6 skipped・flaky 0だった。6 skippedはHTTPS本番専用の2ブラウザ分と、Chromium専用first-paint検査のMobile Safari 4件であり、今回の登録・メニュー検査の省略ではない。これは隔離CIの証拠で、本番メール到達・本番反映の証拠ではない。

同runのContractは生成型の`pending_booking_reminders`不足で1件失敗し、外部接続が未設定の16件を省略した。生成型を手修正してこの失敗を隠さない。本番の実schemaと適用履歴を照合してから正規生成する。

追加する`Local Supabase API contracts (no skips)`は、既存E2E jobが起動した使い捨てSupabaseへ2つの実API suiteを接続する。接続先は明示的なloopback URLに限定し、anonとservice roleの両鍵を必須とし、結果JSONで2 suites成功・省略ゼロを要求する。外部stagingの代わりにrepository migrationの再現性を確認する層であり、hosted stagingや本番設定を確認したとは扱わない。生成型とmigrationの静的比較は従来のContract jobに残し、別gateとして失敗を維持する。

予約RPCのanon拒否とservice roleの既知の`BOOKING_CONFLICT`は、その拒否経路の到達証拠だけである。予約成功や全分岐の`0A000`不在は証明せず、予約作成・変更のE2Eと組み合わせる。RLSのINSERT拒否probeは、退行時に書込みが成功する可能性があるため、明示local隔離環境でのみ動かす。外部stagingではこれらのmutation probeを省略する。

空のfresh DBで`facility_reviews`・`referral_codes`のanon SELECTが空配列になることは、RLSの実効性やtenant分離全体の証明ではない。この2検査はAPI到達と返却契約の範囲に限る。RLS漏洩防止の動的証明には、既知の合成行と複数ロールを使った専用fixtureが別途必要であり、今回のAPI2 suites省略ゼロをその代替にはしない。
