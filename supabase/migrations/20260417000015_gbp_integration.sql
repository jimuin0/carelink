-- GBP（Google ビジネスプロフィール）連携
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS gbp_place_id TEXT;
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS gbp_cid TEXT;
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS gbp_connected_at TIMESTAMPTZ;

-- GBP投稿管理
CREATE TABLE IF NOT EXISTS gbp_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  title TEXT,
  body TEXT NOT NULL,
  post_type TEXT DEFAULT 'STANDARD',   -- STANDARD / OFFER / EVENT / PRODUCT
  status TEXT DEFAULT 'draft',         -- draft / scheduled / published / failed
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  photo_url TEXT,
  cta_type TEXT,                       -- BOOK / ORDER / SHOP / LEARN_MORE / SIGN_UP / CALL
  cta_url TEXT,
  gbp_post_id TEXT,                    -- Google側のpost ID（投稿後に取得）
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gbp_posts_facility ON gbp_posts(facility_id);
CREATE INDEX IF NOT EXISTS idx_gbp_posts_status ON gbp_posts(status);
ALTER TABLE gbp_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "facility_members_gbp_posts" ON gbp_posts
  USING (
    facility_id IN (
      SELECT facility_id FROM facility_members WHERE user_id = auth.uid()
    )
  );

-- GBP診断スコアのキャッシュ
CREATE TABLE IF NOT EXISTS gbp_audit_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE UNIQUE,
  score INTEGER,
  details JSONB,
  fetched_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE gbp_audit_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "facility_members_gbp_audit" ON gbp_audit_cache
  USING (
    facility_id IN (
      SELECT facility_id FROM facility_members WHERE user_id = auth.uid()
    )
  );
