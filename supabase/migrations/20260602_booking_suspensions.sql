-- ネット予約の時間帯指定 一括停止（HPB同等化 #03/#09/#10）
-- 指定日の時間帯を停止登録し、ネット予約の空き表示・予約確定の双方で当該範囲を除外する。
CREATE TABLE IF NOT EXISTS facility_booking_suspensions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id  UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  suspend_date DATE NOT NULL,
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_time < end_time)
);

CREATE INDEX IF NOT EXISTS idx_booking_suspensions_facility_date
  ON facility_booking_suspensions (facility_id, suspend_date);

-- 公開予約フロー(anonクライアント)が停止範囲を参照できるよう SELECT は公開。
-- 書き込みは service-role(管理API)のみ（書き込みポリシーを作らず RLS で遮断）。
ALTER TABLE facility_booking_suspensions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read booking suspensions" ON facility_booking_suspensions;
CREATE POLICY "public read booking suspensions" ON facility_booking_suspensions FOR SELECT USING (true);
