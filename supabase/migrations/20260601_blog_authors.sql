-- ブログ投稿者（スタッフ外）管理。施設ごとに最大5名想定。
CREATE TABLE IF NOT EXISTS blog_authors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_blog_authors_facility ON blog_authors (facility_id);

ALTER TABLE blog_authors ENABLE ROW LEVEL SECURITY;

-- 施設メンバー(owner/admin)のみ参照可（書き込みは service-role API 経由）
DROP POLICY IF EXISTS "blog_authors member select" ON blog_authors;
CREATE POLICY "blog_authors member select" ON blog_authors
  FOR SELECT TO authenticated
  USING (facility_id IN (SELECT facility_id FROM facility_members WHERE user_id = auth.uid()));

-- ブログ投稿の外部投稿者参照（任意）
ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS author_name_id UUID REFERENCES blog_authors(id) ON DELETE SET NULL;
