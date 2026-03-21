-- =============================================
-- CareLink: 口コミ + お問い合わせ
-- =============================================

-- 1. facility_reviews テーブル
CREATE TABLE IF NOT EXISTS facility_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  reviewer_name TEXT NOT NULL,
  rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  status TEXT DEFAULT 'published' CHECK (status IN ('published', 'hidden')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facility_reviews_facility ON facility_reviews(facility_id);
CREATE INDEX IF NOT EXISTS idx_facility_reviews_status ON facility_reviews(status);

ALTER TABLE facility_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read published reviews"
  ON facility_reviews FOR SELECT TO anon
  USING (status = 'published');

CREATE POLICY "Anyone can insert reviews"
  ON facility_reviews FOR INSERT TO anon
  WITH CHECK (true);

-- 2. facility_inquiries テーブル
CREATE TABLE IF NOT EXISTS facility_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  facility_name TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facility_inquiries_facility ON facility_inquiries(facility_id);

ALTER TABLE facility_inquiries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert inquiries"
  ON facility_inquiries FOR INSERT TO anon
  WITH CHECK (true);

-- 3. rating_avg / rating_count 自動更新トリガー
CREATE OR REPLACE FUNCTION update_facility_rating()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE facility_profiles SET
      rating_avg = COALESCE((
        SELECT ROUND(AVG(rating)::numeric, 1)
        FROM facility_reviews
        WHERE facility_id = NEW.facility_id AND status = 'published'
      ), 0),
      rating_count = (
        SELECT COUNT(*)
        FROM facility_reviews
        WHERE facility_id = NEW.facility_id AND status = 'published'
      )
    WHERE id = NEW.facility_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE facility_profiles SET
      rating_avg = COALESCE((
        SELECT ROUND(AVG(rating)::numeric, 1)
        FROM facility_reviews
        WHERE facility_id = OLD.facility_id AND status = 'published'
      ), 0),
      rating_count = (
        SELECT COUNT(*)
        FROM facility_reviews
        WHERE facility_id = OLD.facility_id AND status = 'published'
      )
    WHERE id = OLD.facility_id;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_facility_rating
  AFTER INSERT OR UPDATE OR DELETE ON facility_reviews
  FOR EACH ROW EXECUTE FUNCTION update_facility_rating();
