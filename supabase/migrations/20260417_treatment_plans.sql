-- 治療計画（v8.41）
-- 複数回の施術プラン提案・進捗管理

CREATE TABLE IF NOT EXISTS treatment_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id     UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  staff_id        UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  diagnosis       TEXT,          -- 診断・主訴
  goal            TEXT,          -- 治療目標
  total_sessions  INTEGER NOT NULL DEFAULT 1 CHECK (total_sessions > 0),
  completed_sessions INTEGER NOT NULL DEFAULT 0,
  frequency       TEXT,          -- 通院頻度（例: 週2回）
  duration_weeks  INTEGER,       -- 期間（週）
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'discontinued', 'paused')),
  started_at      DATE,
  ended_at        DATE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN treatment_plans.frequency IS '通院頻度（例: 週2回, 月4回）';
COMMENT ON COLUMN treatment_plans.total_sessions IS '計画施術回数';
COMMENT ON COLUMN treatment_plans.completed_sessions IS '完了済み施術回数';

CREATE INDEX IF NOT EXISTS idx_treatment_plans_facility ON treatment_plans (facility_id, status);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_user ON treatment_plans (user_id, facility_id);

CREATE OR REPLACE FUNCTION update_treatment_plans_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_treatment_plans_updated_at
  BEFORE UPDATE ON treatment_plans
  FOR EACH ROW EXECUTE FUNCTION update_treatment_plans_updated_at();

-- RLS: 施設管理者のみ
ALTER TABLE treatment_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "treatment_plans_facility_all" ON treatment_plans FOR ALL USING (
  EXISTS (
    SELECT 1 FROM facility_members
    WHERE user_id = auth.uid()
      AND facility_id = treatment_plans.facility_id
      AND role IN ('owner', 'admin')
  )
);
