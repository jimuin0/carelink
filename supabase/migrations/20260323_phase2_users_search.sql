-- Phase 2: ユーザーシステム + 検索強化
-- profiles, favorites, areas, view_count

-- 1. profiles テーブル（auth.usersに連動）
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  email TEXT,
  phone TEXT,
  prefecture TEXT,
  city TEXT,
  birth_date DATE,
  gender TEXT CHECK (gender IN ('male', 'female', 'other', 'unspecified')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Auto-insert on signup" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- profiles 自動作成トリガー
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, display_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', ''), NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 2. favorites テーブル
CREATE TABLE IF NOT EXISTS favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, facility_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_facility ON favorites(facility_id);

ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own favorites" ON favorites FOR ALL USING (auth.uid() = user_id);

-- 3. areas テーブル（エリア階層）
CREATE TABLE IF NOT EXISTS areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  area_type TEXT NOT NULL CHECK (area_type IN ('region', 'prefecture', 'city', 'station')),
  parent_id UUID REFERENCES areas(id),
  sort_order INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_areas_parent ON areas(parent_id);
CREATE INDEX IF NOT EXISTS idx_areas_type ON areas(area_type);

ALTER TABLE areas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read areas" ON areas FOR SELECT USING (true);

-- 4. facility_profiles に view_count 追加
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS view_count INT DEFAULT 0;

-- view_count インクリメント RPC
CREATE OR REPLACE FUNCTION increment_view_count(facility_uuid UUID)
RETURNS void AS $$
  UPDATE facility_profiles SET view_count = view_count + 1 WHERE id = facility_uuid;
$$ LANGUAGE sql SECURITY DEFINER;
