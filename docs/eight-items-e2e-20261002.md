# 残件1・2・5：隔離検証証拠（2026-10-02）

## 実行済み

対象は作業ブランチのローカルコード。実顧客、本番DB、外部メール送信、通知、公開、deploy、migration適用には触れていない。

- PostgreSQL 17.6 の既存使い捨て `carelink_shadow`（ローカルUNIX socket、port 56419）を利用。
- `registration-recovery-fixtures.sql`、`facility-setup-fixtures.sql`、`listing-booking-fixtures.sql`、`inquiry-reply-fixtures.sql` を `psql -X -v ON_ERROR_STOP=1` で順次実行、exit 0。各fixtureは合成データをtransaction内で作成しROLLBACK。ログ `/tmp/carelink-eight-items-rollback-fixtures.log`。
- `tests/contract/migration-prod-drift.contract.test.ts`：17 tests / 1 suite PASS。ログ `/tmp/carelink-eight-items-static-contract.log`。
- `e2e/admin-access-recovery.spec.ts` ESLint PASS。Playwright `--list --project=chromium` は4件を発見。これはブラウザ実行成功を意味しない。

## 新しいブラウザ回帰テスト

既存の隔離CI専用 `admin-access-recovery.spec.ts` に、本人の合成owner・2店舗を使う1件を追加。最初の所属店舗への暗黙固定を前提にせず、店舗Bを明示する。

1. dashboard / menus / staff / analytics の選択中BとURLを照合。
2. dashboard「本日の予約一覧」リンクが `from=to=JST当日` と `facility_id=B` を保持することを照合。
3. 実予約一覧がBの本日予約だけを表示し、B翌日・A当日を表示しないことを照合。
4. Bスタッフの一覧→編集→保存→戻るURLと永続DB変更を照合。Aスタッフは変更されない。
5. ブラウザのスタッフ取得503を注入し、空フォーム保存を許さず、明示再試行でBの保存済みデータに復帰。PATCHを自動再送しない。

このテストの実行結果は最新SHAのCI結果で追記する必要がある。ChromiumとMobile Safariの既存公開プロジェクトに含まれる。

## ローカル実Auth E2Eのブロッカー

既存 `carelink` Docker stackは9日前から稼働しており、DB/Auth/Kong/Inbucketがunhealthy。既存stackを停止・resetしなかった。loopback API 54321は応答せず、`supabase status` もDB不健康で失敗。

別ディレクトリ・別project_id `carelink-eight-items-20261002`・ポート54420〜54429にコピーした使い捨てstackを起動したが、Docker VMが新規ネットワークのNAT rule作成時に `fork/exec /usr/sbin/iptables: input/output error` で失敗。CLIは新規タスク側コンテナを掃除し、タスク名コンテナがないことを確認した。既存stackは変更していない。

したがって登録復旧→店舗作成→無料掲載の `registration-recovery-linkage.spec.ts`、管理予約の `admin.spec.ts` をローカル実Authで完走した証拠はない。DB fixtureとブラウザ `--list` をE2E成功へ昇格させない。CIの新規Supabase→TLS proxy→production build→Playwright lifecycleで結果を取得する必要がある。問い合わせ返信のDB回復fixtureは成功したが、実メール送信は未許可・未実行。

## Storage事前照合SQLの独立確認

`supabase/deferred-migrations/salon_storage_preflight.sql` は `BEGIN TRANSACTION READ ONLY` 内で設定・bucket・policy・RLS・history・集計をSELECTしROLLBACKする。履歴statement本文やobject名・metadataは返さない。

native shadowはCLI適用ではないため `supabase_migrations.schema_migrations` が存在せず、原文実行は履歴SELECTで止まった。この制約を本番履歴欠落とは解釈しない。一時コピーで履歴SELECTだけを明示的なfixture制約メッセージに置換し、残りの原文SELECTを実行したところexit 0 / ROLLBACK。ログ `/tmp/carelink-eight-items-storage-preflight-native.log`。原文の本番・Supabase migration ledgerとの照合成功は未確認。
