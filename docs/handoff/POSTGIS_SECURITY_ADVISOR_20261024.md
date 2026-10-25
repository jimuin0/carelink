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

### 2026-10-25 追記：サポートからの返信

既存チケット `SU-513978` に、10/24 17:33 UTC付の担当者返信（Gmail message ID `1a16ef95c5a3be68`）が届いた。サポートは `supabase_admin` 所有のため利用者自身では移設できず、管理者権限で `extensions` へ移設できると回答した。**実施前にバックアップがあることを確認し、準備完了を返信してほしい**との依頼である。こちらが質問した正確な操作・既存列と索引への影響の検証方法・失敗時の復旧手順は具体化されていない。バックアップの取得可能性・復元可能性も、この確認では実証していない。

同日の読み取りでは Security Advisor の `rls_disabled_in_public`（`spatial_ref_sys`）と `extension_in_public`（`postgis` を含む）は継続。**移設も追加メールも実行していない。** 事前にバックアップと復旧方法を確認し、サポートの操作・検証・復旧手順を具体化してから、本人に対象プロジェクトと本番変更の影響を示して書面承認を得る。従前の確認メール1通の許可を、この承認に読み替えない。

### 2026-10-25 追記：本番バックアップの画面確認

本人がサイドバー内のSupabaseへログインした後、`carelink` / `xzafxiupbflvgbarrihe` の **Database > Backups > Scheduled backups** を読み取り確認した。10/18〜10/24 UTC の物理バックアップ7件が表示され、最新は **2026-10-24 20:27:17 UTC**。各行には「Restore」ボタンがあるが、復元は実行していない。**Point in time** 画面は追加オプションの有効化を案内しており、PITR は現在無効。画面はDBバックアップに Storage API のファイル本体が含まれないと明記する。

したがって、バックアップの**存在表示**は確認済みだが、復元後の整合性・変更直前時点までの復旧・Storage の保全は未検証。最新スナップショットからの本番復元は、それ以降の正当な書き込みを失う可能性がある。移設承認前に、サポートへ変更直前の保護方法と障害時の具体的な復旧手順を確認する。新規PITR課金・復元・DBコピーは行わない。

本人がこの確認メール1通のみを明示許可したため、同日、既存チケット `SU-513978` の同じスレッドへ追加質問を送信した（Gmail SENT message ID `1a171788d68d9156`、送信済み本文を読戻し確認）。バックアップの表示状況とPITR未有効を伝え、管理者の正確な操作・変更直前の保護方法・失敗時の復旧と検証手順を質問した。**本番移設を承認しないことを明記**し、移設・復元・課金変更は実行していない。回答待ちを移設完了扱いにしない。

### 2026-10-26 追記：管理者手順の回答と実施前の不足

同じチケットに 2026-10-25 14:59:53 UTC 付の担当者返信（Gmail message ID `1a173934440937d1`）が届いた。サポートは管理者側で `pg_extension.extrelocatable` を一時的に true にし、単一トランザクション中で `ALTER EXTENSION postgis SET SCHEMA extensions`、`3.3.7next` を経由した `ALTER EXTENSION ... UPDATE`、最後に extrelocatable を false に戻して COMMIT する手順を示した。エラー時はトランザクションをロールバックし、事前バックアップを推奨している。これは**サポートからの手順説明であって実施・承認の記録ではない**。利用者側で `pg_extension` を直接更新しない。

同日 18:20 UTC の読取では、PostGIS は引き続き `public` / 3.3.7 / `extrelocatable=false` / 所有者 `supabase_admin`。`extensions` スキーマと 3.3.7・3.3.7next の利用可能版は存在する。Security Advisor の `spatial_ref_sys` RLS 無効、`postgis` public 配置、公開 `st_estimatedextent` 指摘も継続。公開 health は healthy / 配信版 `2108251`。直近の画面上の物理バックアップは 10/24 20:27:17 UTC で、変更直前の保護にはならず、PITR は無効。サポート返信は、**COMMIT 後に異常が分かった場合のデータを失わない復旧方法、直前バックアップの取得・復元確認、既存 geography 列と GiST 索引の検証**をまだ具体化していない。

したがって管理者へ「準備完了」「移設実施」を返信せず、本番変更も行わない。次は新しいバックアップの時刻・取得/復元可能性を確認し、サポートに COMMIT 後の復旧と検証の条件を確認する。追加メールと本番移設は、それぞれ本人の新たな明示許可が必要。既存の確認メール許可を流用しない。

### 2026-10-26 追記：許可された追加確認メール

本人が既存チケット `SU-513978` への確認メール1通を明示許可した。承認されたGmailアカウントから既存のSupabaseサポートスレッドへ送信し、Gmail SENT message ID `1a1747bdcf36d5eb` の本文を読戻し確認した。質問は、PITRを新規契約しない前提での変更直前の整合したバックアップと復元可能性、COMMIT後に異常が判明した場合の正当な書き込みを失わない復旧方法、既存の `geography(Point,4326)` 列・3つの非NULL値・GiST索引・SRID・関数・権限・接続の事前事後検証である。移設、復元、課金の承認を含まないことを明記した。送信後の同スレッド読戻し時点で新たな担当者回答はない。本番移設は実行していない。

同日の Security Advisor は `public.public_reviews` の SECURITY DEFINER view も報告する。ただしこれは PostGIS と別件で、非公開列 `reviewer_ip` 等を投影せず公開済み・未通報・公開施設の口コミだけを返すための現行設計。元の `facility_reviews` は anon/authenticated とも直接 SELECT 不可で、RLS 有効。view を `security_invoker=true` に変えるだけでは公開一覧を壊し、元テーブルへ SELECT を付けるのは非公開列の露出につながる。警告を解消済みとは数えないが、安全性を損なう形式的変更は行わない。これを根本的に組み替える場合は、公開専用テーブル等の設計・同期・権限試験を別途行う。

対象は `xzafxiupbflvgbarrihe` の PostGIS の `public` → `extensions` 移設に限定する。チケット `SU-513978` の管理者手順は得たが、変更直前の保護・COMMIT 後の復旧条件・影響範囲を確認してから移設の可否を本人へ提示する。**送信済みの確認メール 1 通の許可は移設の承認でも、さらにメールを送る許可でもない。本番 DB を変更する書面承認と追加の外部送信は、別途本人の明示許可を得てから行う。** 二重チケットは作らない。

Supabase による移設後、以下を読み取りで照合する。どれか失敗したら完了とせず、同じチケットで復旧を求める。

1. `pg_extension.extnamespace` が `extensions`。Data API の公開スキーマに `extensions` がないこと。
2. `public.spatial_ref_sys` が公開 Data API から到達不能。Security Advisor の PostGIS 関連指摘が消えたこと。`pg_net` など別拡張の指摘は混同しない。
3. `facility_profiles.location` の型、非 NULL 3 行の件数、GiST インデックス、SRID 4326 行が維持されること。
4. `search_facilities_nearby` と `sync_facility_location` の定義・search_path が維持され、合成座標の読み取りが成功すること。アプリの既存 DB 接続は移設後に旧スキーマを参照する場合があるので、必要な再接続後に公開 health と位置検索を確認する。
5. 本番データの試験変更・実予約・顧客通知は行わない。配信済みコードの版と本番動作を別々に記録する。

公式根拠: [Supabase Knowledge Base: Security Advisor flags spatial_ref_sys](https://supabase.com/kb/troubleshooting/security-advisor-flags-spatial_ref_sys-and-other-postgis-objects-in-the-public-schema)。本番 SQL 読み取りと Advisor、Supabase チケットの実測に基づく。過去の全ログ、実際の第三者操作、移設後の動作は未確認。
