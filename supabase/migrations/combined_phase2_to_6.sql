-- =============================================================================
-- CareLink Combined Migration: Phase 2 ~ Phase 6
-- Generated: 2026-03-26
--
-- Phase 1 (facilities), RLS, storage, contacts, reviews/inquiries are
-- already applied and NOT included here.
--
-- This script is wrapped in a transaction for safety and uses
-- IF NOT EXISTS / CREATE OR REPLACE where possible for idempotency.
-- =============================================================================

BEGIN;

-- =============================================================================
-- Phase 2: ユーザーシステム + 検索強化
-- profiles, favorites, areas, view_count
-- =============================================================================

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

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users read own profile') THEN
    CREATE POLICY "Users read own profile" ON profiles FOR SELECT USING (auth.uid() = id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users update own profile') THEN
    CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Auto-insert on signup') THEN
    CREATE POLICY "Auto-insert on signup" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
  END IF;
END $$;

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

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'favorites' AND policyname = 'Users manage own favorites') THEN
    CREATE POLICY "Users manage own favorites" ON favorites FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

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

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'areas' AND policyname = 'Public read areas') THEN
    CREATE POLICY "Public read areas" ON areas FOR SELECT USING (true);
  END IF;
END $$;

-- 4. facility_profiles に view_count 追加
ALTER TABLE facility_profiles ADD COLUMN IF NOT EXISTS view_count INT DEFAULT 0;

-- view_count インクリメント RPC
CREATE OR REPLACE FUNCTION increment_view_count(facility_uuid UUID)
RETURNS void AS $$
  UPDATE facility_profiles SET view_count = view_count + 1 WHERE id = facility_uuid;
$$ LANGUAGE sql SECURITY DEFINER;


-- =============================================================================
-- Phase 3: スタッフ & クーポン
-- =============================================================================

-- スタッフプロフィール
CREATE TABLE IF NOT EXISTS staff_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  position TEXT,
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
  discount_value INT,
  special_price INT,
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

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'staff_profiles' AND policyname = 'staff_profiles_public_read') THEN
    CREATE POLICY "staff_profiles_public_read" ON staff_profiles FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'staff_photos' AND policyname = 'staff_photos_public_read') THEN
    CREATE POLICY "staff_photos_public_read" ON staff_photos FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'coupons' AND policyname = 'coupons_public_read') THEN
    CREATE POLICY "coupons_public_read" ON coupons FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'coupon_menus' AND policyname = 'coupon_menus_public_read') THEN
    CREATE POLICY "coupon_menus_public_read" ON coupon_menus FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'menu_staff' AND policyname = 'menu_staff_public_read') THEN
    CREATE POLICY "menu_staff_public_read" ON menu_staff FOR SELECT USING (true);
  END IF;
END $$;

-- インデックス
CREATE INDEX IF NOT EXISTS idx_staff_profiles_facility ON staff_profiles(facility_id);
CREATE INDEX IF NOT EXISTS idx_staff_photos_staff ON staff_photos(staff_id);
CREATE INDEX IF NOT EXISTS idx_coupons_facility ON coupons(facility_id);
CREATE INDEX IF NOT EXISTS idx_coupon_menus_coupon ON coupon_menus(coupon_id);
CREATE INDEX IF NOT EXISTS idx_menu_staff_menu ON menu_staff(menu_id);


-- =============================================================================
-- Phase 4: オンライン予約
-- =============================================================================

-- スタッフ週間スケジュール
CREATE TABLE IF NOT EXISTS staff_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  UNIQUE(staff_id, day_of_week)
);

-- スケジュール例外日（休日・時間変更）
CREATE TABLE IF NOT EXISTS schedule_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  is_holiday BOOLEAN DEFAULT false,
  start_time TIME,
  end_time TIME,
  UNIQUE(staff_id, date)
);

-- 予約
CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  staff_id UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
  menu_id UUID REFERENCES facility_menus(id) ON DELETE SET NULL,
  coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL,
  booking_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  customer_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
  total_price INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE staff_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'staff_schedules' AND policyname = 'staff_schedules_public_read') THEN
    CREATE POLICY "staff_schedules_public_read" ON staff_schedules FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'schedule_overrides' AND policyname = 'schedule_overrides_public_read') THEN
    CREATE POLICY "schedule_overrides_public_read" ON schedule_overrides FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bookings' AND policyname = 'bookings_owner_read') THEN
    CREATE POLICY "bookings_owner_read" ON bookings FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bookings' AND policyname = 'bookings_insert') THEN
    CREATE POLICY "bookings_insert" ON bookings FOR INSERT WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bookings' AND policyname = 'bookings_owner_update') THEN
    CREATE POLICY "bookings_owner_update" ON bookings FOR UPDATE USING (auth.uid() = user_id);
  END IF;
END $$;

-- インデックス
CREATE INDEX IF NOT EXISTS idx_staff_schedules_staff ON staff_schedules(staff_id);
CREATE INDEX IF NOT EXISTS idx_schedule_overrides_staff_date ON schedule_overrides(staff_id, date);
CREATE INDEX IF NOT EXISTS idx_bookings_facility ON bookings(facility_id);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_staff_date ON bookings(staff_id, booking_date);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date);

-- 空き枠計算RPC
CREATE OR REPLACE FUNCTION get_available_slots(
  p_facility_id UUID,
  p_staff_id UUID,
  p_date DATE,
  p_duration_minutes INT
)
RETURNS TABLE(slot_start TIME, slot_end TIME)
LANGUAGE plpgsql
AS $$
DECLARE
  v_day_of_week INT;
  v_work_start TIME;
  v_work_end TIME;
  v_is_holiday BOOLEAN;
  v_current_start TIME;
  v_current_end TIME;
BEGIN
  v_day_of_week := EXTRACT(DOW FROM p_date);

  SELECT so.is_holiday, so.start_time, so.end_time
  INTO v_is_holiday, v_work_start, v_work_end
  FROM schedule_overrides so
  WHERE so.staff_id = p_staff_id AND so.date = p_date;

  IF FOUND AND v_is_holiday THEN
    RETURN;
  END IF;

  IF v_work_start IS NULL THEN
    SELECT ss.start_time, ss.end_time
    INTO v_work_start, v_work_end
    FROM staff_schedules ss
    WHERE ss.staff_id = p_staff_id AND ss.day_of_week = v_day_of_week;
  END IF;

  IF v_work_start IS NULL THEN
    RETURN;
  END IF;

  v_current_start := v_work_start;
  WHILE v_current_start + (p_duration_minutes || ' minutes')::INTERVAL <= v_work_end LOOP
    v_current_end := v_current_start + (p_duration_minutes || ' minutes')::INTERVAL;

    IF NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.staff_id = p_staff_id
        AND b.booking_date = p_date
        AND b.status NOT IN ('cancelled', 'no_show')
        AND b.start_time < v_current_end
        AND b.end_time > v_current_start
    ) THEN
      slot_start := v_current_start;
      slot_end := v_current_end;
      RETURN NEXT;
    END IF;

    v_current_start := v_current_start + '30 minutes'::INTERVAL;
  END LOOP;
END;
$$;


-- =============================================================================
-- Phase 5: サロン管理ダッシュボード
-- =============================================================================

-- 施設メンバー（権限管理）
CREATE TABLE IF NOT EXISTS facility_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'admin', 'staff')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, facility_id)
);

-- 顧客来店履歴
CREATE TABLE IF NOT EXISTS customer_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  customer_email TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  visit_date DATE NOT NULL,
  menu_name TEXT,
  staff_name TEXT,
  amount INT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE facility_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_visits ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'facility_members' AND policyname = 'facility_members_own_read') THEN
    CREATE POLICY "facility_members_own_read" ON facility_members FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_visits' AND policyname = 'customer_visits_member_read') THEN
    CREATE POLICY "customer_visits_member_read" ON customer_visits FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM facility_members fm
        WHERE fm.facility_id = customer_visits.facility_id
        AND fm.user_id = auth.uid()
      )
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_visits' AND policyname = 'customer_visits_member_insert') THEN
    CREATE POLICY "customer_visits_member_insert" ON customer_visits FOR INSERT WITH CHECK (
      EXISTS (
        SELECT 1 FROM facility_members fm
        WHERE fm.facility_id = customer_visits.facility_id
        AND fm.user_id = auth.uid()
      )
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bookings' AND policyname = 'bookings_facility_member_read') THEN
    CREATE POLICY "bookings_facility_member_read" ON bookings FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM facility_members fm
        WHERE fm.facility_id = bookings.facility_id
        AND fm.user_id = auth.uid()
      )
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'bookings' AND policyname = 'bookings_facility_member_update') THEN
    CREATE POLICY "bookings_facility_member_update" ON bookings FOR UPDATE USING (
      EXISTS (
        SELECT 1 FROM facility_members fm
        WHERE fm.facility_id = bookings.facility_id
        AND fm.user_id = auth.uid()
      )
    );
  END IF;
END $$;

-- インデックス
CREATE INDEX IF NOT EXISTS idx_facility_members_user ON facility_members(user_id);
CREATE INDEX IF NOT EXISTS idx_facility_members_facility ON facility_members(facility_id);
CREATE INDEX IF NOT EXISTS idx_customer_visits_facility ON customer_visits(facility_id);
CREATE INDEX IF NOT EXISTS idx_customer_visits_email ON customer_visits(customer_email);


-- =============================================================================
-- Phase 6: 高度な機能
-- ヘアカタログ、ブログ、口コミ返信、ポイント
-- =============================================================================

-- ヘアカタログ（施術例）
CREATE TABLE IF NOT EXISTS treatment_catalogs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
  menu_id UUID REFERENCES facility_menus(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  before_photo_url TEXT,
  after_photo_url TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ブログ記事
CREATE TABLE IF NOT EXISTS blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facility_profiles(id) ON DELETE CASCADE,
  author_id UUID REFERENCES staff_profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  content TEXT NOT NULL,
  thumbnail_url TEXT,
  is_published BOOLEAN DEFAULT false,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(facility_id, slug)
);

-- 口コミ返信（1レビュー1返信）
CREATE TABLE IF NOT EXISTS review_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID NOT NULL UNIQUE REFERENCES facility_reviews(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ポイント
CREATE TABLE IF NOT EXISTS user_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  points INT NOT NULL,
  reason TEXT NOT NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE treatment_catalogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_points ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'treatment_catalogs' AND policyname = 'treatment_catalogs_public_read') THEN
    CREATE POLICY "treatment_catalogs_public_read" ON treatment_catalogs FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'blog_posts' AND policyname = 'blog_posts_published_read') THEN
    CREATE POLICY "blog_posts_published_read" ON blog_posts FOR SELECT USING (is_published = true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'review_replies' AND policyname = 'review_replies_public_read') THEN
    CREATE POLICY "review_replies_public_read" ON review_replies FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_points' AND policyname = 'user_points_own_read') THEN
    CREATE POLICY "user_points_own_read" ON user_points FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'blog_posts' AND policyname = 'blog_posts_member_all') THEN
    CREATE POLICY "blog_posts_member_all" ON blog_posts FOR ALL USING (
      EXISTS (SELECT 1 FROM facility_members fm WHERE fm.facility_id = blog_posts.facility_id AND fm.user_id = auth.uid())
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'treatment_catalogs' AND policyname = 'treatment_catalogs_member_all') THEN
    CREATE POLICY "treatment_catalogs_member_all" ON treatment_catalogs FOR ALL USING (
      EXISTS (SELECT 1 FROM facility_members fm WHERE fm.facility_id = treatment_catalogs.facility_id AND fm.user_id = auth.uid())
    );
  END IF;
END $$;

-- インデックス
CREATE INDEX IF NOT EXISTS idx_treatment_catalogs_facility ON treatment_catalogs(facility_id);
CREATE INDEX IF NOT EXISTS idx_blog_posts_facility ON blog_posts(facility_id);
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON blog_posts(facility_id, slug);
CREATE INDEX IF NOT EXISTS idx_review_replies_review ON review_replies(review_id);
CREATE INDEX IF NOT EXISTS idx_user_points_user ON user_points(user_id);


COMMIT;
