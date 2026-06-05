# DB（Supabase）起因インシデント Runbook

| 項目 | 値 |
|---|---|
| 重要度 | 🔴 高 |
| 想定対応時間 | 60分 |
| 最終訓練日 | 2026-05-25 |

---

## 1. 検知方法

### 自動検知パス
- **Sentry**: `PGRST` / `permission denied` / `connection refused` エラー
- **Vercel Logs**: Functions で Supabase クライアントが timeout
- **Slack `#alerts-prod`**: DB error 集中通知
- **`/api/health`**: Supabase 依存チェック NG

### 手動検知パス
- ログインできない / 新規登録できない報告
- 自分のブラウザで再現確認
- Supabase Dashboard で error rate スパイク

---

## 2. 初動 5 分

1. **Supabase Dashboard** → Project Health / Logs を開く
2. **症状を 3 分類に切り分け**:
   - 接続不能（DNS / token 失効 / Supabase ダウン）
   - マイグレーション失敗
   - RLS 違反検知 / trigger 異常
3. Sentry の top error メッセージを Slack に投稿
4. Supabase status page を確認（[external-dep-down.md](./external-dep-down.md) 参照）
5. 直近の DB マイグレーション / トリガー変更 commit を `git log` で確認

---

## 3. 判断分岐

- **条件 A — 全 API が 5xx / 接続不能**
  → 手順 X: Supabase status 確認 → 緑なら token 失効疑い
- **条件 B — マイグレーション直後にエラー開始**
  → 手順 Y: マイグレ rollback（4-2 参照）
- **条件 C — 特定機能のみ permission denied / RLS 違反**
  → 手順 Z: 該当テーブルの RLS policy 確認
- **条件 D — Google OAuth 経由ユーザーの表示名が空 / プロフィール異常**
  → 過去事例: **`handle_new_user` trigger が Google OAuth `name` を拾えず空ユーザー量産**
    （commit `ed0f98d fix: Google OAuth ユーザーの表示名空欄問題＋登録ログのaudit_logs統合`）
  → trigger SQL を確認し、`raw_user_meta_data` の `name` / `full_name` / `given_name` 全パスを拾えているか

- **条件 E — 静かなドリフト（本番と repo migration の乖離）**
  → 症状: 本番では動くが新規環境 replay で壊れる / repo の migration を素直に適用すると
    エラー（`0A000` `42703` `42P16` `PGRST202` `PGRST205` 等）/ 「本番だけ直っている」
  → 過去事例（2026-04〜06、ADR-0005 参照）: `create_booking_atomic` の 0A000 landmine、
    `public_reviews` の `user_id` 42703、`facility_card_view` 未作成、`reviewer_ip` PII 漏洩。
    いずれも **out-of-band 修正（本番直接修正で repo 未反映）が根本原因**。
  → 復旧手順は **4-5** を参照

---

## 4. 復旧手順

### 4-1. 接続不能（DNS / token 失効）
1. Supabase Dashboard → Settings → API でキー類が有効か確認（**値は会話に貼らない**）
2. token rotate された痕跡があれば Vercel 環境変数を更新（直接入力）
3. DNS 起因の場合は status page 経過観察 + [external-dep-down.md](./external-dep-down.md) 参照

### 4-2. マイグレーション rollback 手順
1. 失敗したマイグレーション SQL を特定（`supabase/migrations/` 配下 or Dashboard SQL Editor 履歴）
2. 影響テーブルの **直前 snapshot** が Supabase backup にあるか確認
3. 逆方向 SQL を用意（`DROP COLUMN` の逆は `ADD COLUMN` 等）
4. **Staging で先に検証** してから本番適用（時間がかかっても確実性優先）
5. 適用後 `audit_logs` で副作用を確認

### 4-3. RLS 違反検知時
1. 該当テーブルの RLS policy を Supabase Dashboard で確認
2. policy 変更 commit を `git log -- supabase/` で特定
3. policy を旧版に戻す PR を作成（直 push 禁止）
4. 違反期間中のデータ漏洩 / 改変有無を `audit_logs` で確認

### 4-4. trigger 異常時（過去事例: `handle_new_user`）
1. Supabase SQL Editor で `\df handle_new_user` 相当を確認
2. trigger 内の `INSERT` 列マッピングが OAuth `raw_user_meta_data` 構造と整合か確認
3. 修正 SQL を staging で適用 → 本番適用
4. 既に量産された不整合ユーザーは別途 backfill スクリプトで修復

### 4-5. 静かなドリフト（条件 E）の検知・復旧

**検知（発症前に止める）**
1. **contract test**: `tests/contract/schema-invariants.contract.test.ts` を
   staging env（`STAGING_SUPABASE_*`）付きで `npm run test:contract` 実行。
   RPC 存在・予約 RPC の 0A000 landmine・anon の過大公開・列/View 存在を検証する。
   CI では `.github/workflows/ci.yml` の `contract-test` ジョブが PR で自動実行。
2. **gen types 差分**: `supabase gen types typescript --project-id <ref> --schema public`
   を一時ファイルに出力し、`src/types/database.types.ts` と diff。差分が出たらドリフト。
   （read-only introspection。`.env` パース失敗時は `.env` の無い cwd（例 /tmp）から実行）
3. **副作用ゼロ プローブ**: write 系 RPC は zero-UUID の FK 値で呼ぶと、本体実行前に
   `23503`(FK 違反) で弾かれる。`0A000` が返れば landmine 再発、`PGRST202` なら関数不在、
   と状態を無副作用で判別できる。

**復旧（repo と本番を一致させる）**
1. 乖離している本番の実定義を Supabase Dashboard / introspection で確定（推測しない）。
2. **冪等な修復 migration** を `supabase/migrations/YYYYMMDD_*.sql` に新規作成する:
   - `CREATE OR REPLACE FUNCTION/VIEW` / `ADD COLUMN IF NOT EXISTS` /
     `DROP POLICY IF EXISTS` → `CREATE POLICY` を使い、何度適用しても安全にする。
   - `CREATE OR REPLACE VIEW` は既存列の名前・順序・型を変えず、新列は**末尾追加のみ**
     （中間挿入は `42P16`）。
   - 誤定義を含む過去 migration ファイル**本体も**正しい定義に修正する（書き戻し）。
     本番だけ直して repo を放置しない（それがドリフトの発生源）。
3. 神原さんが Dashboard で migration を 1 回適用（本番が既に正しければ実質 no-op）。
4. 適用後に上記「検知」手順を再実行し、ドリフト解消を確認する。
5. ADR-0005（out-of-band 修正禁止）に沿い、緊急 out-of-band 修正は当日中に書き戻す。

---

## 5. 事後対応
- インシデントレポート作成（影響行数・テーブル名を明記）
- `audit_logs` で異常期間中の mutation を全件確認
- 不整合データがあれば backfill スクリプト作成 → 神原さん承認 → 実行
- ADR 起票（trigger / RLS / マイグレ設計の再発防止）
- 同種 trigger を持つ他テーブルも横展開で点検

---

## 6. 連絡先・参考
- 神原さん（責任者）
- Slack `#alerts-prod`
- Supabase Dashboard / Status: https://status.supabase.com
- 関連 commit: `ed0f98d`（handle_new_user trigger 修正）
- 関連 ADR: [adr-0005-no-out-of-band-migrations.md](../adr/adr-0005-no-out-of-band-migrations.md)（out-of-band 修正禁止）
- 関連ファイル: `supabase/migrations/20260602000003_drift_repair.sql`, `supabase/migrations/20260602000001_booking_atomic_0a000_fix.sql`, `tests/contract/schema-invariants.contract.test.ts`
- 関連 runbook: [external-dep-down.md](./external-dep-down.md), [500-surge.md](./500-surge.md)
