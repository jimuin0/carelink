-- 口コミ拡張：HPB 口コミ一覧の「来店日」「担当スタッフ」「予約番号(お客様番号)」「返信」を実カラム化。
-- 既存運用へ無影響にするため全て NULL 許容＋ IF NOT EXISTS。
ALTER TABLE facility_reviews
  ADD COLUMN IF NOT EXISTS visit_date DATE,                                              -- 来店日
  ADD COLUMN IF NOT EXISTS staff_id   UUID REFERENCES staff_profiles(id) ON DELETE SET NULL, -- 担当スタッフ
  ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES bookings(id)       ON DELETE SET NULL, -- 予約番号(お客様番号)の元
  ADD COLUMN IF NOT EXISTS reply      TEXT,                                              -- サロンからの返信本文
  ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;                                       -- 返信日時

CREATE INDEX IF NOT EXISTS idx_facility_reviews_staff_id   ON facility_reviews (staff_id);
CREATE INDEX IF NOT EXISTS idx_facility_reviews_booking_id ON facility_reviews (booking_id);
