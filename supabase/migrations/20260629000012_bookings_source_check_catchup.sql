-- 2026-06-29: bookings.source の CHECK 制約を本番一致で fresh-apply に補完（制約ドリフト根治）。
--
-- 背景（事実・本番 pg_constraint 実測で確定）:
--   本番（ref: xzafxiupbflvgbarrihe）には
--     bookings_source_check CHECK (source = ANY (ARRAY['online','walk_in','phone']))
--   が存在するが、#296（20260629000001）は source 列を ADD COLUMN しただけで
--   この CHECK 制約を再現しておらず、fresh-apply（supabase start＝CI/E2E のローカル DB）に
--   制約が欠落していた（列ドリフトは解消済みだが制約ドリフトが残存）。
--   本番制約全件と migration の突合（2026-06-29）で発見。
--
-- 方針:
--   本番の定義に一致する CHECK を冪等に張り直す（DROP IF EXISTS → ADD）。
--   source 列は 20260629000001（本番先行列 catch-up）で追加済み＝本 migration より前に存在する。
--   本番では同一定義の制約が既存のため実質 no-op（DROP→同一 ADD）。fresh-apply では制約を付与し本番一致。
--   既存行の source は NOT NULL DEFAULT 'online' で必ず許可値のため ADD CONSTRAINT は失敗しない。

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_source_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_source_check
  CHECK (source IN ('online', 'walk_in', 'phone'));
