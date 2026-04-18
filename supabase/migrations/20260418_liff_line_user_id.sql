-- LIFFミニアプリ用: profilesにLINEユーザーID連携カラムを追加

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS line_user_id TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_profiles_line_user_id ON profiles(line_user_id);
