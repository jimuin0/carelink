# PostGIS 公開権限の是正（2026-10-24 実測）

## 結論と説明の訂正

以前の「Supabase のエラー」「サポート回答待ち」という説明は不正確だった。これは現時点の CareLink 障害ではなく、Supabase Security Advisor が検出した **実在する公開書き込み権限**である。原因は PostGIS 3.3.7 が `public` にあり、`supabase_admin` が所有する `public.spatial_ref_sys` に `anon` の INSERT/UPDATE/DELETE が付いていること。匿名キーを持つ第三者が座標系定義を書き換えると、位置検索が失敗する可能性がある。顧客テーブルの匿名読み取りを確認したという意味ではない。

2026-10-24 の本番読み取りでは、`postgis` は `public` / `extrelocatable=false` / 所有者 `supabase_admin`、Security Advisor は `rls_disabled_in_public` 1 件と PostGIS の `extension_in_public` を継続報告した。SRID 4326 行は存在し、合成座標を使った `search_facilities_nearby` 読み取りはエラーなく 0 行を返した。これは現在の経路の限定的な動作確認であり、過去の改ざん不存在の証明ではない。直近 24 時間の Data API 書き込みログ照会は 0 件、`pg_stat_user_tables` の更新/削除は 0 件だったが、ログ保持期間と統計リセット以前は未確認。

本番 `facility_profiles.location` は `geography(Point,4326)` で、5 行中 3 行に値がある。GiST インデックス `idx_facility_profiles_location` もある。**`DROP EXTENSION postgis CASCADE` による自己移行は行わない。** 列・データ・索引・依存関数を失うため。所有者権限のない `postgres` から RLS 設定や REVOKE を成功扱いにしない。

## 済んだ事前確認

- PostGIS を参照するアプリ所有の関数は `public.search_facilities_nearby(...)` と `public.sync_facility_location()`。両方とも本番で `search_path=public, extensions, pg_temp`。公式 KB の「PostGIS を使い、固定 search_path に extensions がない関数」照会は 0 件。コードの `public.ST_*` 直指定や Data API からの `st_*` 直接 RPC 呼び出しも該当なし。
- 自作のログインロールは今回の一覧では特定されていない。Supabase 管理ロールの `rolconfig` は読んだが、すべての外部接続元の接続時 search_path を実証したわけではない。
- Supabase サポートチケット `SU-513978` は受領済み。10/19 の自動回答は、対象 project ref と固定 search_path 確認を記載した**書面承認後**に、拡張を削除せず `extensions` へ単一トランザクションで移すと提示。10/21 に返信催促あり。本人の個別許可で 10/24 に既存チケットへ手順確認メールを 1 通だけ送信済み（Gmail SENT message ID `1a16ca891af622eb`）。正確な操作、前提条件、既存列・索引・関数への影響、検証・復旧方法を質問し、「本番変更をまだ行わず、このメールは移設の書面承認ではない」と明記した。回答と移設は未確認で、完了とは扱わない。

## 次の外部操作と完了判定

対象は `xzafxiupbflvgbarrihe` の PostGIS の `public` → `extensions` 移設に限定する。チケット `SU-513978` の具体的な手順・影響・復旧案の回答を待ち、回答を照合してから移設の可否を本人へ提示する。**確認メール 1 通の許可は移設の承認でも追加メールの許可でもない。本番 DB を変更する書面承認と追加の外部送信は、別途本人の明示許可を得てから行う。** 二重チケットは作らない。

Supabase による移設後、以下を読み取りで照合する。どれか失敗したら完了とせず、同じチケットで復旧を求める。

1. `pg_extension.extnamespace` が `extensions`。Data API の公開スキーマに `extensions` がないこと。
2. `public.spatial_ref_sys` が公開 Data API から到達不能。Security Advisor の PostGIS 関連指摘が消えたこと。`pg_net` など別拡張の指摘は混同しない。
3. `facility_profiles.location` の型、非 NULL 3 行の件数、GiST インデックス、SRID 4326 行が維持されること。
4. `search_facilities_nearby` と `sync_facility_location` の定義・search_path が維持され、合成座標の読み取りが成功すること。アプリの既存 DB 接続は移設後に旧スキーマを参照する場合があるので、必要な再接続後に公開 health と位置検索を確認する。
5. 本番データの試験変更・実予約・顧客通知は行わない。配信済みコードの版と本番動作を別々に記録する。

公式根拠: [Supabase Knowledge Base: Security Advisor flags spatial_ref_sys](https://supabase.com/kb/troubleshooting/security-advisor-flags-spatial_ref_sys-and-other-postgis-objects-in-the-public-schema)。本番 SQL 読み取りと Advisor、Supabase チケットの実測に基づく。過去の全ログ、実際の第三者操作、移設後の動作は未確認。
