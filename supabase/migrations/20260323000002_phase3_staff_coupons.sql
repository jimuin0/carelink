-- Phase 3: スタッフ & クーポン

-- スタッフプロフィール
CREATE TABLE IF NOT EXISTS staff_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  position TEXT, -- 店長, スタイリスト, アシスタント等
  bio TEXT,
  specialties TEXT[] DEFAULT '{}',
  years_experience INT,
  photo_url TEXT,
  instagram_url TEXT,
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(facility_id, slug)
);

-- スタッフ写真（ポートフォリオ / ビフォーアフター）
CREATE TABLE IF NOT EXISTS staff_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  photo_url TEXT NOT NULL,
  caption TEXT,
  photo_type TEXT NOT NULL DEFAULT 'portfolio' CHECK (photo_type IN ('portfolio', 'before_after')),
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- クーポン
CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  coupon_type TEXT NOT NULL DEFAULT 'all' CHECK (coupon_type IN ('new_customer', 'repeat', 'limited_time', 'all')),
  discount_type TEXT NOT NULL DEFAULT 'fixed' CHECK (discount_type IN ('fixed', 'percentage', 'special_price')),
  discount_value INT, -- 円 or %
  special_price INT, -- 特別価格の場合
  valid_from DATE,
  valid_until DATE,
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- クーポン対象メニュー（結合テーブル）
CREATE TABLE IF NOT EXISTS coupon_menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  menu_id UUID NOT NULL REFERENCES facility_menus(id) ON DELETE CASCADE,
  UNIQUE(coupon_id, menu_id)
);

-- メニュー担当スタッフ（結合テーブル）
CREATE TABLE IF NOT EXISTS menu_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id UUID NOT NULL REFERENCES facility_menus(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  UNIQUE(menu_id, staff_id)
);

-- RLSポリシー
ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_staff ENABLE ROW LEVEL SECURITY;

-- 全テーブル: 全員読み取り可能
CREATE POLICY "staff_profiles_public_read" ON staff_profiles FOR SELECT USING (true);
CREATE POLICY "staff_photos_public_read" ON staff_photos FOR SELECT USING (true);
CREATE POLICY "coupons_public_read" ON coupons FOR SELECT USING (true);
CREATE POLICY "coupon_menus_public_read" ON coupon_menus FOR SELECT USING (true);
CREATE POLICY "menu_staff_public_read" ON menu_staff FOR SELECT USING (true);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_staff_profiles_facility ON staff_profiles(facility_id);
CREATE INDEX IF NOT EXISTS idx_staff_photos_staff ON staff_photos(staff_id);
CREATE INDEX IF NOT EXISTS idx_coupons_facility ON coupons(facility_id);
CREATE INDEX IF NOT EXISTS idx_coupon_menus_coupon ON coupon_menus(coupon_id);
CREATE INDEX IF NOT EXISTS idx_menu_staff_menu ON menu_staff(menu_id);
