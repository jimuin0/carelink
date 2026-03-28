-- パフォーマンス最適化インデックス (2026-03-28)

-- 検索ソート用（published限定の部分インデックス）
CREATE INDEX IF NOT EXISTS idx_fp_published_created
  ON facility_profiles(created_at DESC) WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_fp_published_rating
  ON facility_profiles(rating_avg DESC NULLS LAST) WHERE status = 'published';

-- 予約競合チェック用（アクティブ予約のみ）
CREATE INDEX IF NOT EXISTS idx_bookings_staff_date_active
  ON bookings(staff_id, booking_date, start_time, end_time)
  WHERE status NOT IN ('cancelled', 'no_show');

-- 口コミ取得用（施設別・公開済み）
CREATE INDEX IF NOT EXISTS idx_reviews_facility_published
  ON facility_reviews(facility_id, created_at DESC) WHERE status = 'published';
