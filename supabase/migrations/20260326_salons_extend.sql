-- CareLink: salonsテーブル拡張（店舗登録フォーム改善）
-- 2026-03-26

ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS contact_phone TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS website TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS building_name TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS nearest_station TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS has_parking BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS features TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT '審査中',
  ADD COLUMN IF NOT EXISTS photo_urls TEXT[] DEFAULT '{}';

-- statusカラムにコメント追加
COMMENT ON COLUMN salons.status IS '審査中 / 掲載中 / 非公開';
COMMENT ON COLUMN salons.photo_urls IS '写真URL配列（外観・内観・メニュー、最大7枚）';
COMMENT ON COLUMN salons.features IS 'こだわり・特徴タグ配列（constants.tsのfacilityFeaturesから選択）';
