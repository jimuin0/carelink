-- 不正レビュー検知（v8.22）
-- 同一IP・短時間大量投稿を自動フラグ

-- レビュー投稿者IPとフラグカラムを追加
ALTER TABLE facility_reviews
  ADD COLUMN IF NOT EXISTS reviewer_ip TEXT,
  ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS flag_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_reviews_ip ON facility_reviews(reviewer_ip)
  WHERE reviewer_ip IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reviews_flagged ON facility_reviews(is_flagged)
  WHERE is_flagged = TRUE;
