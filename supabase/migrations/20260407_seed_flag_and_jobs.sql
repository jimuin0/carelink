-- CareLink: 都道府県ページ用シードデータ対応
-- 1) facility_profiles に is_seed フラグ追加（一括削除のため）
-- 2) facility_jobs テーブル新規作成（求人）
-- 2026-04-07

-- ============================================================
-- 1. facility_profiles.is_seed
-- ============================================================
ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS is_seed BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_facility_profiles_is_seed
  ON facility_profiles(is_seed);

COMMENT ON COLUMN facility_profiles.is_seed IS 'true=スクリプト生成のダミー施設（cleanup-seed.tsで一括削除可）';

-- ============================================================
-- 2. facility_jobs テーブル
-- ============================================================
CREATE TABLE IF NOT EXISTS facility_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id     UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  job_type        TEXT NOT NULL,           -- 美容師 / 看護師 / 介護士 etc.
  employment_type TEXT NOT NULL,           -- 正社員 / アルバイト / 業務委託
  salary_min      INT,
  salary_max      INT,
  salary_note     TEXT,
  description     TEXT,
  requirements    TEXT,
  benefits        TEXT,
  is_seed         BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facility_jobs_facility ON facility_jobs(facility_id);
CREATE INDEX IF NOT EXISTS idx_facility_jobs_is_seed ON facility_jobs(is_seed);

ALTER TABLE facility_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read jobs of published facilities" ON facility_jobs
  FOR SELECT TO anon
  USING (EXISTS (SELECT 1 FROM facility_profiles WHERE id = facility_jobs.facility_id AND status = 'published'));

COMMENT ON TABLE facility_jobs IS '施設に紐づく求人情報';
COMMENT ON COLUMN facility_jobs.is_seed IS 'true=ダミーデータ';
