-- メニュー全体の備考（HPB「メニュー備考」相当・施設単位の自由記述）
ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS menu_remarks TEXT;
