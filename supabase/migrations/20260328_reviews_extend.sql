-- =============================================
-- CareLink: facility_reviews 5軸評価 + 写真カラム追加
-- =============================================

-- 5軸評価カラム
ALTER TABLE facility_reviews ADD COLUMN IF NOT EXISTS rating_skill INT CHECK (rating_skill >= 1 AND rating_skill <= 5);
ALTER TABLE facility_reviews ADD COLUMN IF NOT EXISTS rating_service INT CHECK (rating_service >= 1 AND rating_service <= 5);
ALTER TABLE facility_reviews ADD COLUMN IF NOT EXISTS rating_atmosphere INT CHECK (rating_atmosphere >= 1 AND rating_atmosphere <= 5);
ALTER TABLE facility_reviews ADD COLUMN IF NOT EXISTS rating_cleanliness INT CHECK (rating_cleanliness >= 1 AND rating_cleanliness <= 5);
ALTER TABLE facility_reviews ADD COLUMN IF NOT EXISTS rating_explanation INT CHECK (rating_explanation >= 1 AND rating_explanation <= 5);

-- 写真URL配列
ALTER TABLE facility_reviews ADD COLUMN IF NOT EXISTS photo_urls TEXT[];

-- 来店確認フラグ
ALTER TABLE facility_reviews ADD COLUMN IF NOT EXISTS is_verified_visit BOOLEAN DEFAULT FALSE;
