-- 2026-06-29: bookings の本番先行列（source / payjp_charge_id）と email の NOT NULL 乖離を
--   migration へ catch-up し、fresh-apply（supabase start＝CI / E2E のローカル DB）が本番を
--   忠実に再現できるようにする（冪等・無破壊）。
--
-- 背景（事実・実データで確定）:
--   本番（ref: xzafxiupbflvgbarrihe）の bookings には以下3点の状態があるが、対応する migration が
--   無く（または乖離しており）、fresh-apply したローカル DB が本番を再現できていなかった。
--   admin E2E（supabase start のローカル DB に対して実行）で「Could not find the 'source' column
--   of 'bookings'」が出たのはこのドリフトが原因（本番にはある source 列がローカル DB に無い）。
--
--   information_schema.columns（本番 SQL Editor 実測）で確定した本番の実 DDL:
--     | column_name     | data_type | is_nullable | column_default |
--     | email           | text      | YES         | null           |
--     | payjp_charge_id | text      | YES         | null           |
--     | source          | text      | NO          | 'online'::text |
--
--   一方 supabase/migrations の bookings 定義は:
--     - source          : 定義が一切無い（本番に out-of-band 追加された列）
--     - payjp_charge_id  : 定義が一切無い（同上・PAY.JP 移行準備で先行追加された列）
--     - email            : 20260323000003_phase4_bookings.sql の CREATE TABLE で `email TEXT NOT NULL`
--                          だが本番は nullable（YES）＝乖離
--
--   src/types/database.types.ts は本番 introspection 生成物（source: string / payjp_charge_id:
--   string | null / email: string | null）で本番と一致しており、型は正しい。是正すべきは migration 側。
--
-- 方針（症状ブロックでなく真の予防＝発症前根治）:
--   本番に合わせて migration を補い、fresh-apply == 本番 を成立させる。これにより CI / E2E が
--   本番と同一スキーマで走り、同種の無音ドリフトを発症前に防ぐ。
--
-- 冪等性・無破壊:
--   - ADD COLUMN IF NOT EXISTS … : 本番では既に列が在るため再適用しても no-op。
--   - source は NOT NULL DEFAULT 'online'（本番の実 DDL と完全一致）。fresh-apply 時に既存行が
--     在っても DEFAULT で backfill されるため NOT NULL でも安全。
--   - ALTER COLUMN email DROP NOT NULL : 本番では既に nullable のため no-op。fresh-apply では
--     制約を緩めるだけで既存データを壊さない。

-- 本番先行列を migration へ反映（本番では no-op）
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'online';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payjp_charge_id TEXT;

-- email の NOT NULL を本番（nullable）に合わせて解除
ALTER TABLE bookings ALTER COLUMN email DROP NOT NULL;

COMMENT ON COLUMN bookings.source IS '予約の発生元（本番 DEFAULT online）。本番先行列を 2026-06-29 に migration へ catch-up。';
COMMENT ON COLUMN bookings.payjp_charge_id IS 'PAY.JP 課金 ID（移行準備の本番先行列）。2026-06-29 に migration へ catch-up。';
