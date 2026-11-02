# PostGIS・pg_net の変更計画と、配信イメージ自動整理の仕組み（2026-10-29）

対象は CareLink（`jimuin0/carelink`・Supabase `xzafxiupbflvgbarrihe`）のみ。**本番 DB は変更していない。**
PostGIS の承認メールは未送信、pg_net は本番では変更しない（本人判断 2026-10-29）。
VCR 用の OIDC ポリシーは未作成（本人が仕組みを確認してから判断）。

## 1. PostGIS（SU-513978）

### 本番での依存関係（2026-10-29 読み取り）

| 対象 | 状態 |
|---|---|
| 拡張 | `postgis` 3.3.7 / `public` / `extrelocatable=false` / 所有者 `supabase_admin`（利用者側では移せない） |
| 列 | `facility_profiles.location`（`geography(Point,4326)`）。施設 10 行中 3 行に値 |
| 索引 | `idx_facility_profiles_location`（`USING gist (location)`） |
| 関数 | `search_facilities_nearby(...)`（anon・authenticated・service_role が実行可）、`sync_facility_location()`。どちらも `search_path=public, extensions, pg_temp` |
| トリガー | `trg_sync_facility_location`（`facility_profiles`）。緯度・経度から `location` を作る |
| ビュー | `location` を参照するビューは無し |
| `spatial_ref_sys` | 8,500 行。RLS 無効・anon の INSERT/UPDATE/DELETE が可能（これが指摘の本体） |
| その他 | 上記以外の依存は PostGIS 自身の内部（演算子族・`geometry_columns` 等） |

3 行の `location` は、3 行とも同じ行の `latitude`・`longitude` と一致する（誤差 1e-9 未満）。
`location` はトリガーが緯度・経度から計算する値なので、失われても緯度・経度から作り直せる。

### 隔離環境での再現（2026-10-28・本番と同じイメージ）

- 環境: 公式 `supabase/postgres:17.6.1.084`（本番と同版。PostgreSQL 17.6、PostGIS 3.3.7、`3.3.7next` 利用可）を Apple `container` の
  `--internal` ネットワークで起動（外部へ DNS・HTTPS とも不通を確認）。shadow bootstrap と migration 全件を適用。合成データのみ。
- 手順と結果:

| 手順 | 結果 |
|---|---|
| ① `SET SCHEMA` の後に 0 除算で失敗させる | ROLLBACK。`public` のまま、件数・権限・関数も不変 |
| ② サポート手順そのまま（`extrelocatable` を一時 true → `ALTER EXTENSION postgis SET SCHEMA extensions` → `UPDATE TO '3.3.7next'` → `UPDATE` → `extrelocatable` を戻して COMMIT） | 成功。`extensions` / 3.3.7 / `extrelocatable=false`。`public` の PostGIS 関数 744 → 0。`spatial_ref_sys` 8,500 行と SRID 4326 は維持。位置検索（近 1 件・遠 0 件）、座標更新でのトリガー、GiST 利用も移設前と同じ |
| ②のスキーマ指紋 | 差分は 1 組だけ（`location` の型名 `public.geography` → `extensions.geography`） |
| ③ COMMIT 後に同じ方法で `public` へ戻す | 成功。指紋は移設前と完全一致（差分 0） |

### 変更直前の保護（実施時）

1. 直前に読み取りで記録する: スキーマ指紋（`get_schema_fingerprint()`）、上の依存表の各値、3 行の `id`・緯度・経度、
   SRID 4326 の `srtext` の md5、Security Advisor の結果、Database > Backups の最新バックアップ時刻。
2. サポートには単一トランザクション・`lock_timeout` 付きでの実行を依頼する（ロック待ちで本番を止めない）。
3. PITR は無効のまま（新規課金をしない）。データを書き換える操作ではないため、保護の主手段は
   「失敗時の自動ロールバック」と「COMMIT 後の逆操作」であり、バックアップ復元には頼らない。

### 失敗時の復旧

- COMMIT 前の失敗: トランザクションが自動で ROLLBACK され、元のまま（①で確認）。
- COMMIT 後に問題が分かった場合: Supabase 側が同じ管理者操作で `public` へ戻す（③で、指紋差分 0 を確認）。
  データを巻き戻さないので、その間の正当な書き込みは失われない。`pg_extension` の更新は `supabase_admin` 権限が要るため、
  実行できるのは Supabase だけ（下書きメールでこの手順を依頼している）。
- `location` が万一失われた場合: 緯度・経度が残っていれば `UPDATE facility_profiles SET latitude = latitude WHERE latitude IS NOT NULL`
  でトリガーが作り直す（本人承認のうえで実行）。
- 移設後に `schema-drift-check` が `location` の型名の 1 組を報告する。期待値（migration 由来）を正式に更新するまでの既知差分。

### 確認していないこと

本番の実データ量でのロック時間、移設時点の既存接続・PostgREST のスキーマキャッシュへの影響、本番の Advisor の実際の変化。
移設後に読み取りで確認する（`POSTGIS_SECURITY_ADVISOR_20261024.md` の完了判定 1〜5）。

## 2. pg_net

### 本番での依存関係（2026-10-29 読み取り）

| 対象 | 状態 |
|---|---|
| 拡張 | `pg_net` 0.20.0 / `public` / `extrelocatable=false` / 所有者 `supabase_admin`。実体の表・関数は `net` スキーマ |
| 利用 | 送信待ち 0 行・送信結果 0 行（一度も使われていない）。`net.http_*` を呼ぶアプリの関数・トリガー・ビューは 0、Database Webhooks のトリガーも 0、repo の migration・コードにも参照なし |
| 依存 | 拡張の外から依存するオブジェクトは 0（通常依存 25 件はすべて `net` 内部の型・既定値・関数どうし） |
| 権限 | `net` の USAGE と `net.http_get` の EXECUTE は anon・authenticated・service_role・postgres が持つ（Supabase 既定）。`net` は Data API の公開対象外 |
| 事前読み込み | `shared_preload_libraries` に `pg_net` を含む |
| pg_cron | ジョブ 1 本（`cron-report-sends-cleanup`、migration 由来）。pg_net は使わない |

### 隔離環境での再現（2026-10-29・本番と同じイメージ）

- 環境: 上と同じ `supabase/postgres:17.6.1.084`、`--internal` ネットワーク（DNS・HTTPS 不通を確認）、migration 全 366 本を適用。
  `CREATE EXTENSION pg_net WITH SCHEMA public` で本番と同じ状態を作り、版・配置・所有オブジェクト 28・権限・依存の内訳・
  事前読み込みが本番と一致することを確認した（違いは GraphQL 用イベントトリガー 2 本だけで pg_net と無関係）。
- 手順と結果（指紋は `get_schema_fingerprint()` の全出力をバイト比較）:

| 手順 | 結果 |
|---|---|
| ① `DROP` → `CREATE ... SCHEMA extensions` の後に 0 除算で失敗 | ROLLBACK。状態・指紋とも移設前と完全一致 |
| ② `DROP EXTENSION pg_net; CREATE EXTENSION pg_net WITH SCHEMA extensions;`（`supabase_admin`） | 成功。`extensions` / 0.20.0、所有オブジェクト 28、権限は移設前と同じ。指紋は完全一致 |
| ②の動作 | `net.http_get` が要求 ID を返し、バックグラウンド処理が結果を記録（外部不通のため「接続できない」として記録＝処理系は動作） |
| ③ `public` へ作り直して戻す | 状態・指紋とも移設前と完全一致 |
| ④ 本番で使える `postgres` ロール（非スーパーユーザー）で②③ | 成功。所有者は `supabase_admin` のまま、指紋は完全一致 |
| ⑤ 安全確認つき下書き `pg_net_move_to_extensions.DRAFT.sql` を `postgres` で実行 | 成功。指紋は完全一致 |
| ⑥ 同下書き・送信待ちが 1 行ある状態 | `pg_net has 1 queued / 0 responses` で停止。`public` のまま |
| ⑦ 同下書き・`net` の表が別の処理でロック中 | `lock_timeout` 5 秒で停止。`public` のまま |

pg_net の作り直しは、スキーマ指紋（拡張が所有するオブジェクトを除外）に現れないので、`schema-drift-check` は何も報告しない。

### 変更直前の保護（実施時）

1. 下書きの冒頭の安全確認が、CareLink の DB であること・0.20.0 が `public` にあること・送信待ちと送信結果が 0 行であること・
   外部からの依存が 0 であることを確かめ、どれかが違えば何もせずに止まる。
2. `lock_timeout 5s`・`statement_timeout 30s` で、ロック待ちによる本番への影響を避ける。
3. 直前に読み取りで状態（版・配置・所有オブジェクト数・権限）と指紋を記録する。作り直しで失うデータは無い（0 行を確認してから実行するため）。

### 失敗時の復旧

- COMMIT 前の失敗・安全確認での停止: 自動 ROLLBACK で元のまま（①⑥⑦で確認）。
- COMMIT 後に問題が分かった場合: `BEGIN; DROP EXTENSION pg_net; CREATE EXTENSION pg_net WITH SCHEMA public VERSION '0.20.0'; COMMIT;`
  で元に戻る（③④で、状態・指紋とも完全一致を確認）。`postgres` ロールで実行でき、Supabase への依頼は不要。

## 3. 配信イメージの自動整理（`vcr-image-retention.yml`）

### 権限の範囲

- GitHub 側: workflow の権限は `contents: read`・`deployments: read`・`id-token: write` だけ。リポジトリへの書き込み権は無い。
- Vercel 側: 長期の鍵は置かない。実行のたびに GitHub の OIDC トークン（この repo・この workflow の実行であることを示す）を
  Vercel の短命トークンへ交換し、終了時（失敗時も）に失効させる。交換は、Vercel のチーム設定にある **VCR 用 OIDC ポリシー**が
  この repo・workflow に一致したときだけ成功する（`vercel/vcr-action/login` と同じ交換方式）。Vercel の文書は、このポリシーを
  「Container Registry への読み書きを許可するもの」と説明している。配信・環境変数・ドメイン等の権限が含まれないことは、
  文書からは断定できないので、ポリシー作成画面に表示される範囲で確認する。
- スクリプトが呼ぶ API は 4 種類だけ: GitHub の本番配信履歴（読み取り）、`https://carelink-jp.com/api/health`（読み取り）、
  VCR のイメージ一覧（読み取り）、VCR のイメージ削除。

### 削除の対象と条件

対象は `carelink` プロジェクトの `dockerfile` リポジトリ（配信ごとに 1 個積まれる）だけ。`node24-public-config` は触らない。
次のどれにも当たらないイメージだけを、古い順に削除する:

1. 作成が新しい順で 20 個以内
2. 作成から 24 時間未満（ビルド中・直後の配信を守る）
3. 稼働中の本番（`/api/health` の `version`）のイメージ
4. GitHub の直近 10 回分の本番配信のコミットのイメージ（ロールバック先）

### 本番で使用中のイメージを守る仕組み

- 稼働中の本番の版を `/api/health` から取り、そのタグのイメージを必ず残す。
- 本番の版を取得できない、版の形式がおかしい、本番配信の履歴が 0 件、**稼働中の本番のイメージが一覧に無い**、の
  どれかなら、何も削除せずに失敗する（一覧の取り違えや誤ったリポジトリでの削除を防ぐ）。
- 削除が 1 件でも失敗したら、そこで止まって失敗として記録する。

### 確認だけで実行する方法

- GitHub の Actions 画面で「VCR image retention」→「Run workflow」。入力 `dry_run` は既定で有効で、
  削除予定のイメージ（ID・タグ・作成日時）を一覧に出すだけで、何も削除しない。
- 2026-10-29 の実データ（残り 25 個）で選定だけを試算すると、削除予定は 3 個（直近 10 回より古い本番配信）。
- 自動実行（main への push・毎日 03:15 JST）は削除まで行う。OIDC ポリシーを作るまでは、トークン交換で失敗して何も削除しない。

### 手動での削除（2026-10-29・本人承認）

OIDC ポリシーは本人の判断で未作成のまま（「まだ作らない」）。代わりに、上の選定（`selectImagesToDelete`）で出した一覧を本人に見せ、承認を得て手で消した。

- 13:21 UTC に 43 個。別の作業ブランチの Preview 配信（約 5 分ごと）が続き、**14:12 UTC に 50 個に達した**。
  14:12〜14:41 UTC の Preview 7 本が `Pushing vcr.vercel.com/jimuin/carelink/dockerfile:<sha> was denied.` で失敗した（本番は 3afd7d7 のまま稼働）。
- 承認した一覧は 19 個（10/26 06:35〜10/28 10:28 作成）。削除の直前に、最新の一覧・稼働中の本番（`/api/health` の `version`）・
  直近 10 回分の本番配信で選定をやり直し、**承認した一覧と今回の選定の両方に入るものだけ**を消した（19 個とも一致。稼働中の本番 3afd7d7 は残る）。
- 結果: 19 個を削除、失敗 0。残り 31 個。削除後の `/api/health` は `healthy`・`version` 3afd7d7。
- 1 日の増え方は本番配信だけなら約 10 個だが、Preview 配信もイメージを 1 個ずつ積む。Preview が続く日は数時間で上限に届く
  （この日は 13:21〜14:12 の約 50 分で 7 個）。自動整理が無い間は、配信が `denied` で失敗したら同じ手順（選定 → 本人承認 → 削除）で戻す。

### 手動での削除（2026-10-30・本人承認）

- 04:0x UTC に 49 個（10/29 14:5x の 31 個から約 13 時間で 18 個増加。#868・#870 などの Preview と本番配信）。
- 上の選定（`selectImagesToDelete`）だけでは 6 個（残り 43 個）で、1 日もたない。そこで本人の承認を得て、
  **マージ済み PR の Preview 用で、本番配信に使われていないもの**21 個を加えた。新しい方から 20 個・24 時間以内を残す基準は、この 21 個には当てはめていない。
- 残したもの: 稼働中の本番 `595248b`、直近 10 回分の本番配信、24 時間以内の本番配信、開いている PR（#866・#872・#873）の Preview 用、
  タグからコミットを特定できないもの（コミットの記録が無い CLI 配信の可能性）、PR に属さないコミットのもの。
- 削除の直前に一覧を取り直し、承認した ID とタグの組が一致したものだけを消した。結果: 27 個を削除、失敗 0。残り 22 個。
  削除後の `/api/health`・`/`・`/search`・`/tokyo` はすべて 200（`version` 595248b）。

### 手動での削除（2026-10-30 2回目・本人承認）

- 09:2x UTC に 32 個。本人の承認を得て 9 個を削除した。内訳は、上の選定（`selectImagesToDelete`）の 4 個、マージ済み PR の Preview 用 3 個、#877 の書き直し前のコミットの分 2 個。
- 削除の直前に一覧を取り直し、承認した ID とタグの組が一致したものだけを消した。結果: 9 個を削除、失敗 0。残り 23 個。
  稼働中の本番 `19a086b` のイメージは残した。削除後の `/api/health`・`/`・`/search`・`/tokyo` はすべて 200。

### 手動での削除（2026-11-01・本人承認）

- 一覧を取った時点で 37 個。本人の承認を得て、2 回に分けて計 17 個を削除した。
- 1 回目（12 個）: #868 の分 3 個、10/30 01:33〜01:46 UTC のタグ無し・`dpl_` 付きのもの 3 個、#873・#872・#866 の古いコミットの分 6 個。
  開いている PR の最新コミットの分（#866 `460512d`・#872 `89b4281`）は残した。結果: 12 個を削除、失敗 0。残り 29 個（作業中に新しい配信の分が増えた）。
- 2 回目（5 個）: 新たに候補になった、マージ済み #870 `595248b`・#871 `175ae2d`・#868 `4dabe5b`・#865 `3afd7d7` の分と、#873 の古いコミット `e722ca0` の分。
  結果: 5 個を削除、失敗 0。残り 24 個。
- どちらも削除の直前に一覧を取り直し、ID・タグ・保持ルールの候補・開いている PR の最新コミット・稼働中の本番の版と照合した。
  稼働中の本番 `4b6ede9` のイメージは残した。
- 自動整理（`vcr-image-retention.yml`）は、OIDC ポリシーが未作成のため、main への push と毎日の定期実行のたびに失敗している（何も削除しない）。

### 自動実行の停止（2026-11-02・本人決定「止めて手で消す」）

- `vcr-image-retention.yml` の自動実行（main への push・毎日 03:15 JST）を止め、手動実行（`workflow_dispatch`）だけを残した。
- OIDC ポリシーは作らない。Cloudflare へ移ると Vercel を使わなくなるため。
- 止める前は、push のたびと毎日、トークン交換の 403 で失敗し続けていた（何も削除していない）。
- 今後は、配信イメージが 40 個に近づいたら `scripts/prune-vcr-images.mjs` の選定で候補を出し、開いている PR の最新コミットの分を分けて示し、本人の承認を得てから手で消す。
