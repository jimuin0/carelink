# ADR-0005: 本番 DB 変更は必ず migration 経由（out-of-band 修正の禁止）

Date: 2026-06-02
Status: Accepted

## Context

2026-04〜06 にかけて、「本番 Supabase の DB を migration 外（Dashboard SQL Editor 等）で
直接修正したが、repo の `supabase/migrations/` に書き戻さなかった」ことに起因する
**静かなスキーマドリフト**（本番と repo の乖離）が複数回顕在化した。確認できた事実:

1. **`create_booking_atomic` の 0A000 landmine**
   `supabase/migrations/20260420000003_booking_insert_rls.sql` の定義は競合チェックに
   `SELECT COUNT(*) ... FOR UPDATE` を持っていた。PostgreSQL は集約関数(COUNT)と
   FOR UPDATE の併用を `0A000`（FOR UPDATE is not allowed with aggregate functions）で
   **プラン時に常に**拒否する。本番は out-of-band で修正済みで動作していたが、repo には
   誤定義が残り、新規環境への replay で予約 API 全滅を再発させる状態だった。

2. **`public_reviews` の `user_id` 42703**
   `supabase/migrations/20260420000007_public_reviews_view.sql` が存在しない列 `user_id` を
   SELECT しており、`CREATE VIEW` が `42703` で失敗 → トランザクション全体が rollback →
   View 未作成かつ直後の `DROP POLICY` も未実行、という二重ドリフトを生んでいた。

3. **`facility_card_view` 未作成 / `reviewer_ip` PII 漏洩**
   View 未作成、および `facility_reviews` の anon 直読みで `reviewer_ip`（PII）が
   露出していた。

これらは 2026-06-02 に `supabase/migrations/20260602000003_drift_repair.sql`（冪等な統合修復）と
`supabase/migrations/20260602000001_booking_atomic_0a000_fix.sql`（予約 RPC の恒久修正）で
repo と本番を一致させ、恒久修正済み。

共通根本原因: **「本番 DB の変更が migration というバージョン管理された単一経路を通らず、
口頭・手作業で本番だけに適用され、repo に書き戻されない」** という運用構造。
型定義 `src/types/database.types.ts` も 2026-03-26 で凍結され実スキーマと乖離していた
（本 ADR と同時に gen types で再生成）。

## Decision

**本番 Supabase の全スキーマ変更（テーブル / 列 / View / RPC / トリガー / RLS ポリシー /
GRANT）は、必ず `supabase/migrations/` の migration ファイル経由でのみ行う。
out-of-band（Dashboard SQL Editor 等での直接適用で repo 未反映）を禁止する。**

実装・運用の要点:

- **緊急 out-of-band 修正を例外的に行った場合は、同一作業内（遅くとも当日中）に
  同一内容の migration を `supabase/migrations/` に書き戻す**。書き戻しを「後でやる」TODO に
  しない（それがドリフトの発生源だった）。
- migration は **冪等**に書く（`CREATE OR REPLACE` / `ADD COLUMN IF NOT EXISTS` /
  `DROP POLICY IF EXISTS` → `CREATE POLICY`）。本番に既適用でも安全に再適用できること。
- `CREATE OR REPLACE VIEW` は既存列の名前・順序・型を変えず、新列は**末尾に追加のみ**
  （中間挿入は `42P16` で失敗する）。
- ドリフトを CI で発症前に検知する: `tests/contract/schema-invariants.contract.test.ts`
  （staging-gated）＋ `.github/workflows/ci.yml` の `contract-test` ジョブ。
- 型のドリフト防止: スキーマ変更時は `supabase gen types typescript` で
  `src/types/database.types.ts` を再生成する。
- 検知・復旧の具体手順は runbook [database-incident.md](../runbooks/database-incident.md)
  の「条件 E — 静かなドリフト」を参照。

## Consequences

**良い点**
- 本番スキーマの変更履歴が git 上に単一の真実として残り、新規環境 replay で再現可能になる。
- ドリフトが contract test で PR 時に検知され、発症前（本番障害化前）に止まる。
- 「本番だけ直って repo は壊れている」状態が構造的に発生しなくなる。

**悪い点 / 受け入れる劣化**
- 緊急時でも migration 書き戻しの一手間が必須になる（速度より確実性を優先する方針に合致）。
- contract ドリフトゲートの実効化には staging 専用 Supabase プロジェクトと
  GitHub Secrets 設定が必要（未設定時はゲート無効・全 skip）。

**残る課題 / 後続 TODO**
- staging Supabase プロジェクトの整備と `STAGING_SUPABASE_*` secrets 設定（神原さん作業）。
- `supabase db diff` ベースの migration 差分ゲート（staging 整備が前提）。
- `src/types/database.types.ts` は現状コードベースから未 import。Supabase クライアントへの
  型付け（`createClient<Database>`）導入は別タスク（スコープ分離）。

## Alternatives（却下案と理由）

- **案 A: out-of-band 修正を許容しつつ定期的に手動で repo 同期**
  → 却下理由: 「後で同期」は実際に守られず、本ドリフト群がまさにその失敗例。仕組みで防げない。
- **案 B: 本番のスキーマを正とし repo migration を廃止（Dashboard 運用）**
  → 却下理由: バージョン管理・レビュー・replay 再現性を失い、ADR-0004 の予防方針に逆行。
- **案 C: 何もしない（従来運用継続）**
  → 却下理由: 静かなドリフトが必ず再発し、予約 API 全滅級の landmine を repo に残し続ける。

## References

- file: `supabase/migrations/20260602000003_drift_repair.sql`（冪等な統合ドリフト修復）
- file: `supabase/migrations/20260602000001_booking_atomic_0a000_fix.sql`（予約 RPC 0A000 恒久修正）
- file: `supabase/migrations/20260420000003_booking_insert_rls.sql`（0A000 landmine を含んでいた定義・修正済）
- file: `supabase/migrations/20260420000007_public_reviews_view.sql`（user_id 42703 を含んでいた定義・修正済）
- file: `tests/contract/schema-invariants.contract.test.ts`（ドリフト恒久ガード）
- file: `.github/workflows/ci.yml`（`contract-test` ジョブ）
- runbook: `docs/runbooks/database-incident.md`（条件 E — 静かなドリフト）
- 関連 ADR: ADR-0004（8 層 Defense in Depth・本 ADR はその Layer 4/7 の具体化）
