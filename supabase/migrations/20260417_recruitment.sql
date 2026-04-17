-- 人材紹介連動: 求職者→施設マッチング手数料システム
-- 既存のjob_postingsテーブルと連動

CREATE TABLE IF NOT EXISTS job_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_posting_id UUID REFERENCES job_postings(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  applicant_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  applicant_name TEXT NOT NULL,
  applicant_email TEXT NOT NULL,
  applicant_phone TEXT,
  cover_letter TEXT,
  resume_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'reviewing', 'interview_scheduled', 'interview_done',
    'offer_made', 'hired', 'rejected', 'withdrawn'
  )),
  referral_fee_yen INT,         -- 成約時の紹介手数料
  hired_at TIMESTAMPTZ,
  fee_invoiced_at TIMESTAMPTZ,
  fee_paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_applications_facility ON job_applications(facility_id, status);
CREATE INDEX IF NOT EXISTS idx_job_applications_job ON job_applications(job_posting_id);
CREATE INDEX IF NOT EXISTS idx_job_applications_applicant ON job_applications(applicant_user_id);

ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;

-- 施設オーナー/管理者は自分の施設への応募を閲覧・更新
CREATE POLICY "job_applications_facility_admin" ON job_applications
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM facility_members
      WHERE facility_id = job_applications.facility_id
        AND user_id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );

-- 応募者は自分の応募を閲覧
CREATE POLICY "job_applications_own" ON job_applications
  FOR SELECT USING (applicant_user_id = auth.uid());

-- プラットフォーム管理者は全件
CREATE POLICY "job_applications_platform_admin" ON job_applications
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND is_platform_admin = TRUE
    )
  );
