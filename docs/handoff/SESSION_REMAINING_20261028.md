# 残課題の読み取り確認と Preview 分離（2026-10-28 JST 夕方）

対象は CareLink（`jimuin0/carelink`・Supabase `xzafxiupbflvgbarrihe`）のみ。追加課金・本番DB変更・メール送信・復元・削除は行っていない。

## 1. PostGIS の公開書き込み権限（外部回答・本人承認待ち）

- 本番読み取り（20:2x JST）: PostgreSQL 17.6（`17.6.1.084`）、`postgis` 3.3.7 / `public` / `extrelocatable=false`。`public.spatial_ref_sys` は RLS 無効、`anon` の INSERT/UPDATE/DELETE はすべて true。SRID 4326 は 1 行、`facility_profiles` 7 行中 `location` 非NULL 3 行、`idx_facility_profiles_location` は valid。
- Security Advisor: `rls_disabled_in_public`（spatial_ref_sys）、`extension_in_public`（postgis・pg_net）、`st_estimatedextent` 3 本の anon/authenticated 実行は継続。
- チケット SU-513978: Gmail の同一スレッドで最後のメッセージは 10/26 04:13 JST のこちらからの確認質問。その後サポートの返信なし。追加送信はしていない。
- 10/28 01:37 JST の Supabase 週次セキュリティ通知では、CareLink は `rls_disabled_in_public` のみ（既知の spatial_ref_sys）。

## 2. バックアップと PITR（本人判断待ち）

- 組織プランは Pro。Scheduled backups は 10/21〜10/27 UTC の物理バックアップ 7 件、最新 2026-10-27 20:28:06 UTC。
- PITR はアドオン未有効（画面は「Enable add-on」）。Storage のファイル本体は DB バックアップに含まれないと画面が明記。
- 「Restore to new project（BETA）」は新規プロジェクト作成＝課金を伴うため実行していない。復元可能性は未実証のまま。

## 3. PostGIS 移設手順の隔離再現（本番同版イメージ・合成データのみ）

前回（10/28 昼）は PostGIS 3.5.2 のイメージで移設操作だけを確認し、本番の 3.3.7 と `3.3.7next` を経由する手順は再現できていなかった。今回はその不足を埋めた。

- 環境: 公式イメージ `supabase/postgres:17.6.1.084`（本番の `database.version` と同一。PostgreSQL 17.6、PostGIS 3.3.7、利用可能版 `3.3.7,3.3.7next`）を Apple `container` で起動。ホスト専用の internal ネットワークに置き、コンテナから外部への HTTPS が失敗することを確認した。本番 DB の複製・実データは使っていない。
- 準備: イメージ初期の `auth.users` には GoTrue が後から足す列（`email_confirmed_at` 等）が無いので、隔離 DB に限り `ADD COLUMN IF NOT EXISTS` で補った。その上で shadow bootstrap と migration 全 365 本を `supabase_admin` で適用（すべて成功）。PostGIS は `public` / 3.3.7 / `extrelocatable=false` / 所有者 `supabase_admin` で、本番と同じ形になった。
- 移設前の `get_schema_fingerprint()` は期待値と同じ 3,406 行。違いはポリシー 78 件の `auth.uid()` と `(SELECT auth.uid() AS uid)` の表記差だけで、イメージ側の `auth.uid()` 定義に由来する（PostGIS とは無関係）。
- 合成施設 1 件で、匿名ロールの `search_facilities_nearby` は近距離 1 件・遠距離 0 件。座標を更新するとトリガー経由で `location` が更新され、新しい位置でだけ見つかる。`enable_seqscan=off` で `idx_facility_profiles_location` が使われた。

| 手順 | 結果 |
|---|---|
| ① 途中でエラーを起こしたトランザクション（`SET SCHEMA` の後に 0 除算） | ROLLBACK。PostGIS は `public` のまま、件数・権限・関数も変化なし |
| ② サポートが提示した手順そのまま（`extrelocatable` 一時変更 → `SET SCHEMA extensions` → `UPDATE TO '3.3.7next'` → `UPDATE` → 戻して COMMIT） | 成功。PostGIS は `extensions` / 3.3.7 / `extrelocatable=false`。`public` の PostGIS 関数 744 → 0、`spatial_ref_sys` 8,500 行・SRID 4326 は維持。位置検索・座標更新・GiST 利用も移設前と同じ結果 |
| ②の指紋差分 | missing 1 / extra 1 のみ。`facility_profiles.location` の型名 `public.geography(Point,4326)` → `extensions.geography(Point,4326)` |
| ③ COMMIT 後に戻す（同じ方法で `SET SCHEMA public`） | 成功。指紋は移設前と完全一致（差分 0）、合成データ・位置検索・GiST も維持 |

分かったこと:

- サポート手順は、本番と同じ版の組み合わせで最後まで通る。失敗時は ROLLBACK で元のまま残る。
- **COMMIT 後に問題が見つかった場合も、バックアップを戻さずに同じ管理者操作で `public` へ戻せる**（隔離環境で指紋差分 0 を確認）。データを巻き戻さないので、その間の正当な書き込みは失われない。ただし `pg_extension` の更新は `supabase_admin` 権限が必要なので、実行できるのは Supabase 側だけ。
- 移設後も `anon` は `extensions.spatial_ref_sys` への INSERT 権と `extensions` スキーマの USAGE を持つ。Data API から届かなくなるのは `extensions` が公開スキーマに含まれないためで、権限そのものは残る。
- 監視は移設後に `location` 型名の 1 件差分を出す。移設後に期待値を正式に再生成するまで、`schema-drift-check` がこの 1 件を報告する可能性がある。

確認していないこと: 本番の実データ量でのロック時間、移設時点で開いている既存接続・PostgREST のスキーマキャッシュへの影響、`pg_net` など本番だけにある構成との相互作用、本番の Security Advisor の変化、バックアップからの復元。これらは本番移設時に読み取りで確認する。

## 4. Preview の認証・書き込み分離（修正・PR #857）

- Vercel Preview の環境変数に 10/25 から `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY`（本番の公開値）がある。service-role は無い。Deployment Protection は Vercel Authentication（Standard）。
- 実際の Preview（`carelink-8rmez0bug-jimuin.vercel.app`、`/api/health` は `scope: public-preview`）で `/auth/login` の入力欄・Google ログインが表示され、CSP `connect-src` が本番 project を指していた（送信はしていない）。
- 本番の anon/public 向け書き込みポリシーはすべてログイン本人・施設メンバー条件。PR #857 で公開 Preview の認証・会員/店舗画面・変更系メソッドを 403 で止めた。
- Supabase の開発ブランチは 0 件。隔離 hosted 環境での「ログイン・書き込みの成功」は未測定。

## 5. CPU と無料枠（未達）

- Vercel Usage（Sep 28 05:00〜Oct 28 05:00 表示）: CareLink の Fluid Active CPU 14h 19m、チーム合計 15h 18m（referral-system 等を含む）。Fluid Provisioned Memory はチーム 642.2 GB-Hrs。画面には「Limits increased 3x Until Nov 24」。
- 日別グラフは 10/21〜10/26 に 1.5〜2.3 時間/日の山があり、その後は減少しているが、通常 Hobby の 4 時間/月の水準ではない。上限超過時の扱い・請求額は画面で確認していない。

## 6・7. 口コミ・未参照画像

- 本番の `facility_reviews` 0 件、`public_reviews` 0 件、`review_helpful` 0 件。実口コミでの表示確認は引き続き不可。
- `carelink-uploads` 69 件中、既存照合 SQL で未参照 64 件（変化なし）。削除していない。

## 新たに見つかった警告

- Security Advisor の `anon_security_definer_function_executable` に `public.published_special_hours(uuid)`（PR #855・10/28 マージ）が追加。公開済み施設の休業日・祝日休・受付締切だけを返す設計で、`facility_card_view` から呼ばれる。PR #851 と同じく非公開スキーマへ移すかは別判断。DB は変更していない。

## Preview 配信の失敗（基盤側）

PR #857 の Preview ビルドは、アプリのビルド後に `vcr.vercel.com/jimuin/carelink/dockerfile` へのイメージ push が拒否されて失敗した。同じ失敗は 10/28 の他ブランチの Preview でも繰り返し出ており（同日 10:28・10:37 UTC の配信は成功）、コード起因ではない。ダッシュボードからの再配信はメールコードによる本人再認証を求められたため実行していない。
