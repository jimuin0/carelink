-- 施術履歴トラッキング（v8.41）
-- 施設スタッフが患者の施術経過を記録・参照できる機能

CREATE TABLE IF NOT EXISTS treatment_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id     UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  booking_id      UUID REFERENCES bookings(id) ON DELETE SET NULL,
  staff_id        UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
  treated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  menu_name       TEXT,
  subjective      TEXT,   -- 主訴・訴え（S）
  objective       TEXT,   -- 所見・測定（O）
  assessment      TEXT,   -- 評価・診断（A）
  plan            TEXT,   -- 治療計画（P）
  notes           TEXT,   -- その他メモ
  next_visit_note TEXT,   -- 次回来院時の注意事項
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN treatment_records.subjective IS 'SOAP: 主訴・患者の訴え';
COMMENT ON COLUMN treatment_records.objective IS 'SOAP: 他覚所見・測定値';
COMMENT ON COLUMN treatment_records.assessment IS 'SOAP: 評価・アセスメント';
COMMENT ON COLUMN treatment_records.plan IS 'SOAP: 治療計画・次回方針';

CREATE INDEX IF NOT EXISTS idx_treatment_records_facility ON treatment_records (facility_id, treated_at DESC);
CREATE INDEX IF NOT EXISTS idx_treatment_records_user ON treatment_records (user_id, facility_id);
CREATE INDEX IF NOT EXISTS idx_treatment_records_booking ON treatment_records (booking_id);

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION update_treatment_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_treatment_records_updated_at
  BEFORE UPDATE ON treatment_records
  FOR EACH ROW EXECUTE FUNCTION update_treatment_records_updated_at();

-- RLS: 施設管理者のみアクセス可能（患者のプライバシー保護）
ALTER TABLE treatment_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "treatment_records_facility_all" ON treatment_records FOR ALL USING (
  EXISTS (
    SELECT 1 FROM facility_members
    WHERE user_id = auth.uid()
      AND facility_id = treatment_records.facility_id
      AND role IN ('owner', 'admin')
  )
);
