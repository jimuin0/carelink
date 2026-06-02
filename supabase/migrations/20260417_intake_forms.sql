-- 施術前デジタル問診票（v8.36）
-- 来院前にオンラインで記入できる問診票システム
-- 施設ごとにカスタマイズ可能なフォーム定義 + 患者回答を管理

-- 問診票テンプレート（施設ごとに定義）
CREATE TABLE IF NOT EXISTS intake_form_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id  UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  title        TEXT NOT NULL DEFAULT '問診票',
  description  TEXT,
  fields       JSONB NOT NULL DEFAULT '[]',  -- 質問フィールドの配列
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 施設ごとに1つのアクティブテンプレート
  UNIQUE (facility_id, is_active) DEFERRABLE INITIALLY DEFERRED
);

-- fields の構造:
-- [{ id, type, label, required, options?, placeholder? }]
-- type: text | textarea | select | radio | checkbox | date | boolean

-- 問診票回答（予約に紐づく）
CREATE TABLE IF NOT EXISTS intake_form_responses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  UUID NOT NULL REFERENCES intake_form_templates(id) ON DELETE CASCADE,
  booking_id   UUID REFERENCES bookings(id) ON DELETE SET NULL,
  facility_id  UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  responses    JSONB NOT NULL DEFAULT '{}',  -- { field_id: value }
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  viewed_at    TIMESTAMPTZ,  -- スタッフが閲覧した時刻
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intake_templates_facility ON intake_form_templates (facility_id);
CREATE INDEX IF NOT EXISTS idx_intake_responses_facility ON intake_form_responses (facility_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_intake_responses_booking ON intake_form_responses (booking_id) WHERE booking_id IS NOT NULL;

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION update_intake_template_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_intake_template_updated_at ON intake_form_templates;
CREATE TRIGGER trg_intake_template_updated_at
  BEFORE UPDATE ON intake_form_templates
  FOR EACH ROW EXECUTE FUNCTION update_intake_template_updated_at();

-- RLS
ALTER TABLE intake_form_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_form_responses ENABLE ROW LEVEL SECURITY;

-- テンプレートは施設メンバーが管理、公開用は誰でも閲覧可
CREATE POLICY "intake_template_facility_read" ON intake_form_templates FOR SELECT USING (
  is_active = TRUE OR EXISTS (
    SELECT 1 FROM facility_members WHERE facility_id = intake_form_templates.facility_id AND user_id = auth.uid()
  )
);
CREATE POLICY "intake_template_facility_write" ON intake_form_templates FOR ALL USING (
  EXISTS (SELECT 1 FROM facility_members WHERE facility_id = intake_form_templates.facility_id AND user_id = auth.uid())
);

-- 回答は施設メンバーが閲覧、自分の回答は本人が閲覧
CREATE POLICY "intake_response_user_read" ON intake_form_responses FOR SELECT USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM facility_members WHERE facility_id = intake_form_responses.facility_id AND user_id = auth.uid()
  )
);
CREATE POLICY "intake_response_insert" ON intake_form_responses FOR INSERT WITH CHECK (true);

COMMENT ON TABLE intake_form_templates IS '問診票テンプレート。施設ごとにカスタマイズ可能なJSONBフィールド定義。';
COMMENT ON TABLE intake_form_responses IS '問診票回答。予約に紐づき、来院前にオンラインで提出。';

-- 標準問診票テンプレートのシードデータ（鍼灸院向け）
-- 実際の施設IDで上書きするため、ここでは構造確認用のコメントのみ
-- INSERT INTO intake_form_templates (facility_id, title, fields) VALUES (
--   '施設ID', '初診問診票', '[
--     {"id":"chief_complaint","type":"textarea","label":"主訴・お悩みの症状","required":true,"placeholder":"例: 肩こりと腰痛が続いています"},
--     {"id":"symptom_duration","type":"select","label":"症状が続いている期間","required":true,"options":["1週間未満","1ヶ月未満","3ヶ月未満","半年未満","1年以上"]},
--     {"id":"medical_history","type":"textarea","label":"既往症・持病","required":false,"placeholder":"例: 高血圧、糖尿病など"},
--     {"id":"medications","type":"text","label":"現在服用中のお薬","required":false,"placeholder":"例: 降圧剤、血液サラサラのお薬など"},
--     {"id":"allergy","type":"boolean","label":"金属アレルギーはありますか？","required":true},
--     {"id":"pregnant","type":"boolean","label":"妊娠中または妊娠の可能性がありますか？","required":true},
--     {"id":"experience","type":"radio","label":"鍼灸の経験はありますか？","required":true,"options":["初めて","数回ある","定期的に通院中"]},
--     {"id":"how_found","type":"radio","label":"当院をお知りになったきっかけ","required":false,"options":["インターネット検索","CareLink","知人・家族の紹介","その他"]}
--   ]'
-- );
