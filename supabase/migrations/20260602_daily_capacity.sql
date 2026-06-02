-- サロンの受付可能枠数（日別・HPB同等化 #05/#46）
-- 指定日のネット予約受付上限を保持。当日の予約数が上限に達するとネット予約の空き表示・受付を自動停止する。
-- 行が無い日は無制限（従来どおり）。
CREATE TABLE IF NOT EXISTS facility_daily_capacity (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id   UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  capacity_date DATE NOT NULL,
  max_bookings  INT  NOT NULL CHECK (max_bookings >= 0),
  created_by    UUID,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (facility_id, capacity_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_capacity_facility_date
  ON facility_daily_capacity (facility_id, capacity_date);

-- 公開予約フロー(anonクライアント)が上限を参照できるよう SELECT は公開。書き込みは service-role(管理API)のみ。
ALTER TABLE facility_daily_capacity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read daily capacity" ON facility_daily_capacity;
CREATE POLICY "public read daily capacity" ON facility_daily_capacity FOR SELECT USING (true);
