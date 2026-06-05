-- デザインテンプレート設定（テーマ/カラー）保存用。NULL許容・IF NOT EXISTS・既存無影響。
ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS design_template TEXT,  -- テンプレート種別（standard/elegant/natural/cute）
  ADD COLUMN IF NOT EXISTS design_color    TEXT;  -- テーマカラー（pink/blue/green/brown/black）
