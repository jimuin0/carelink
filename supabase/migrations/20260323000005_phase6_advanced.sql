-- Phase 6: 高度な機能

-- ヘアカタログ（施術例）
CREATE TABLE IF NOT EXISTS treatment_catalogs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
  menu_id UUID REFERENCES facility_menus(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  before_photo_url TEXT,
  after_photo_url TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ブログ記事
CREATE TABLE IF NOT EXISTS blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  author_id UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  content TEXT NOT NULL,
  thumbnail_url TEXT,
  is_published BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(facility_id, slug)
);

-- 口コミ返信（1レビュー1返信）
CREATE TABLE IF NOT EXISTS review_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL UNIQUE REFERENCES facility_reviews(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ポイント
CREATE TABLE IF NOT EXISTS user_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  points INT NOT NULL,
  reason TEXT NOT NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE treatment_catalogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "treatment_catalogs_public_read" ON treatment_catalogs FOR SELECT USING (true);
CREATE POLICY "blog_posts_published_read" ON blog_posts FOR SELECT USING (is_published = true);
CREATE POLICY "review_replies_public_read" ON review_replies FOR SELECT USING (true);
CREATE POLICY "user_points_own_read" ON user_points FOR SELECT USING (auth.uid() = user_id);

-- 施設メンバーによる管理操作
CREATE POLICY "blog_posts_member_all" ON blog_posts FOR ALL USING (
  EXISTS (SELECT 1 FROM facility_members fm WHERE fm.facility_id = blog_posts.facility_id AND fm.user_id = auth.uid())
);
CREATE POLICY "treatment_catalogs_member_all" ON treatment_catalogs FOR ALL USING (
  EXISTS (SELECT 1 FROM facility_members fm WHERE fm.facility_id = treatment_catalogs.facility_id AND fm.user_id = auth.uid())
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_treatment_catalogs_facility ON treatment_catalogs(facility_id);
CREATE INDEX IF NOT EXISTS idx_blog_posts_facility ON blog_posts(facility_id);
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON blog_posts(facility_id, slug);
CREATE INDEX IF NOT EXISTS idx_review_replies_review ON review_replies(review_id);
CREATE INDEX IF NOT EXISTS idx_user_points_user ON user_points(user_id);
