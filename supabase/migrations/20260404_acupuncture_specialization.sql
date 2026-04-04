-- 鍼灸院・整骨院特化（v8.2）

-- 保険適用メニュー拡張
ALTER TABLE facility_menus ADD COLUMN IF NOT EXISTS insurance_covered BOOLEAN DEFAULT false;
ALTER TABLE facility_menus ADD COLUMN IF NOT EXISTS insurance_note TEXT;
ALTER TABLE facility_menus ADD COLUMN IF NOT EXISTS insurance_price INT;

-- スタッフ資格拡張
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS certifications TEXT[] DEFAULT '{}';

-- 対応症状マスタ
CREATE TABLE IF NOT EXISTS symptoms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  sort_order INT DEFAULT 0
);

ALTER TABLE symptoms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON symptoms FOR SELECT USING (true);

-- 初期データ（主要30症状）
INSERT INTO symptoms (name, slug, category, sort_order) VALUES
  ('腰痛', 'low-back-pain', '筋骨格系', 1),
  ('肩こり', 'stiff-shoulder', '筋骨格系', 2),
  ('首の痛み', 'neck-pain', '筋骨格系', 3),
  ('膝痛', 'knee-pain', '筋骨格系', 4),
  ('五十肩', 'frozen-shoulder', '筋骨格系', 5),
  ('ぎっくり腰', 'acute-back-pain', '筋骨格系', 6),
  ('椎間板ヘルニア', 'herniated-disc', '筋骨格系', 7),
  ('坐骨神経痛', 'sciatica', '神経系', 8),
  ('頭痛', 'headache', '神経系', 9),
  ('めまい', 'dizziness', '神経系', 10),
  ('自律神経失調症', 'autonomic-dysfunction', '神経系', 11),
  ('不眠症', 'insomnia', '神経系', 12),
  ('顔面神経麻痺', 'facial-palsy', '神経系', 13),
  ('生理痛', 'menstrual-pain', '婦人科系', 14),
  ('更年期障害', 'menopause', '婦人科系', 15),
  ('不妊', 'infertility', '婦人科系', 16),
  ('冷え性', 'cold-sensitivity', '婦人科系', 17),
  ('むくみ', 'edema', '全身症状', 18),
  ('疲労回復', 'fatigue-recovery', '全身症状', 19),
  ('ストレス', 'stress', '全身症状', 20),
  ('眼精疲労', 'eye-strain', '全身症状', 21),
  ('胃腸の不調', 'digestive-issues', '内科系', 22),
  ('花粉症', 'hay-fever', '内科系', 23),
  ('アレルギー', 'allergy', '内科系', 24),
  ('スポーツ障害', 'sports-injury', 'スポーツ', 25),
  ('捻挫', 'sprain', 'スポーツ', 26),
  ('骨折後のリハビリ', 'post-fracture-rehab', 'スポーツ', 27),
  ('交通事故', 'traffic-accident', '交通事故', 28),
  ('むちうち', 'whiplash', '交通事故', 29),
  ('産後の骨盤矯正', 'postpartum-pelvic', '婦人科系', 30)
ON CONFLICT (name) DO NOTHING;

-- 施設×症状 対応表
CREATE TABLE IF NOT EXISTS facility_symptoms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  symptom_id UUID NOT NULL REFERENCES symptoms(id) ON DELETE CASCADE,
  description TEXT,
  UNIQUE(facility_id, symptom_id)
);

ALTER TABLE facility_symptoms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON facility_symptoms FOR SELECT USING (true);
CREATE POLICY "Facility members can manage" ON facility_symptoms
  FOR ALL USING (EXISTS (
    SELECT 1 FROM facility_members
    WHERE facility_members.facility_id = facility_symptoms.facility_id
      AND facility_members.user_id = auth.uid()
      AND facility_members.role IN ('owner', 'admin')
  ));

-- 施設の資格・認定情報
CREATE TABLE IF NOT EXISTS facility_certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  certification_name TEXT NOT NULL,
  license_number TEXT,
  staff_name TEXT,
  sort_order INT DEFAULT 0
);

ALTER TABLE facility_certifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON facility_certifications FOR SELECT USING (true);
CREATE POLICY "Facility members can manage" ON facility_certifications
  FOR ALL USING (EXISTS (
    SELECT 1 FROM facility_members
    WHERE facility_members.facility_id = facility_certifications.facility_id
      AND facility_members.user_id = auth.uid()
      AND facility_members.role IN ('owner', 'admin')
  ));

-- インデックス
CREATE INDEX IF NOT EXISTS idx_facility_symptoms_facility ON facility_symptoms(facility_id);
CREATE INDEX IF NOT EXISTS idx_facility_certifications_facility ON facility_certifications(facility_id);
CREATE INDEX IF NOT EXISTS idx_symptoms_category ON symptoms(category);
CREATE INDEX IF NOT EXISTS idx_facility_menus_insurance ON facility_menus(facility_id) WHERE insurance_covered = true;
