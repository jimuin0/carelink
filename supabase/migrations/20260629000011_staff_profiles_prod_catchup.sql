-- 2026-06-29: staff_profiles の本番先行列を migration へ catch-up し、fresh-apply が本番を
--   忠実に再現できるようにする（冪等・無破壊・本番では no-op）。
--
-- 背景（事実・実データで確定）:
--   staff_profiles は 20260323000003_phase4_bookings.sql で nomination_fee 等を持たない形で
--   作成され、本番に out-of-band 追加された列が fresh-apply（supabase start）に反映されて
--   いなかった。来院者 予約完走 E2E で「column staff_profiles.nomination_fee does not exist」
--   が出たのはこのドリフトが原因（予約フローのスタッフ取得・予約作成が壊れる／preview でも実害）。
--
--   本番（ref: xzafxiupbflvgbarrihe）の information_schema.columns 実測 DDL（神原さん確認）:
--     | column_name           | data_type | is_nullable | column_default |
--     | nomination_fee        | integer   | YES         | 0              |
--     | certifications        | ARRAY     | YES         | '{}'::text[]   |
--     | line_works_channel_id | text      | YES         | null           |
--     | line_works_notify_all | boolean   | NO          | false          |
--
-- 冪等性・無破壊: ADD COLUMN IF NOT EXISTS のみ。本番（列が既に存在）では完全な no-op。

ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS nomination_fee INTEGER DEFAULT 0;
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS certifications TEXT[] DEFAULT '{}'::text[];
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS line_works_channel_id TEXT;
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS line_works_notify_all BOOLEAN NOT NULL DEFAULT false;
