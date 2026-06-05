-- CareLink: 初期テーブル定義（salons, contacts, job_seekers）
-- ダッシュボードで手動作成されていたテーブルのマイグレーション記録
-- 2026-03-20（実際の作成日に合わせた番号）

-- ============================================================
-- salons: 施設掲載登録フォームからのデータ
-- ============================================================
CREATE TABLE IF NOT EXISTS salons (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz DEFAULT now(),
  facility_name       text NOT NULL,
  business_type       text NOT NULL,
  representative_name text NOT NULL,
  contact_name        text NOT NULL,
  email               text NOT NULL,
  phone               text NOT NULL,
  postal_code         text,
  address             text,
  business_hours      text,
  regular_holiday     text,
  seat_count          integer,
  staff_count         integer,
  pr_text             text,
  photo_url           text,
  desired_start_date  date,
  status              text DEFAULT 'pending',
  is_public           boolean DEFAULT false
);

COMMENT ON TABLE salons IS '施設掲載登録フォームからのデータ（/register）';
COMMENT ON COLUMN salons.status IS 'pending / 審査中 / 掲載中 / 非公開';
COMMENT ON COLUMN salons.is_public IS 'true=APIで公開表示';

-- ============================================================
-- contacts: お問い合わせフォームからのデータ
-- ============================================================
CREATE TABLE IF NOT EXISTS contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz DEFAULT now(),
  name         text NOT NULL,
  email        text NOT NULL,
  inquiry_type text NOT NULL,
  message      text NOT NULL,
  phone        text
);

COMMENT ON TABLE contacts IS 'お問い合わせフォームからのデータ（/contact）';

-- ============================================================
-- job_seekers: 求職者登録フォームからのデータ
-- ============================================================
CREATE TABLE IF NOT EXISTS job_seekers (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at              timestamptz DEFAULT now(),
  full_name               text NOT NULL,
  furigana                text NOT NULL,
  birth_date              date,
  gender                  text,
  postal_code             text,
  address                 text,
  phone                   text NOT NULL,
  email                   text NOT NULL,
  job_type                text NOT NULL,
  certifications          text[],
  experience_years        integer,
  education               text,
  previous_job            text,
  desired_employment_type text[],
  desired_location        text,
  desired_salary          text,
  self_pr                 text,
  photo_url               text,
  status                  text DEFAULT 'pending'
);

COMMENT ON TABLE job_seekers IS '求職者登録フォームからのデータ（/recruit）';
COMMENT ON COLUMN job_seekers.status IS 'pending / 審査中 / 承認';
