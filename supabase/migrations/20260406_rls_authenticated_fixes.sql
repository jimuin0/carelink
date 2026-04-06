-- 2026-04-06: RLS修正（認証済みユーザーのSELECT権限追加 + bookings.points_used追加）
-- 背景: 認証済みユーザー（authenticated）がfacility_profiles等を読めず、admin画面が500エラーになっていた

-- 1. facility_profiles: authenticated ユーザーにもpublished施設の読み取りを許可
CREATE POLICY IF NOT EXISTS "Authenticated read published"
  ON facility_profiles FOR SELECT TO authenticated
  USING (status = 'published');

-- 2. facility_menus: authenticated ユーザーに読み取り許可
CREATE POLICY IF NOT EXISTS "auth_read_menus"
  ON facility_menus FOR SELECT TO authenticated
  USING (true);

-- 3. facility_photos: authenticated ユーザーに読み取り許可
CREATE POLICY IF NOT EXISTS "auth_read_photos"
  ON facility_photos FOR SELECT TO authenticated
  USING (true);

-- 4. facility_reviews: authenticated ユーザーに読み取り許可
CREATE POLICY IF NOT EXISTS "auth_read_reviews"
  ON facility_reviews FOR SELECT TO authenticated
  USING (true);

-- 5. facility_inquiries: authenticated ユーザーに読み取り許可
CREATE POLICY IF NOT EXISTS "auth_read_inquiries"
  ON facility_inquiries FOR SELECT TO authenticated
  USING (true);

-- 6. bookings: INSERT権限を明示的にanon+authenticatedに付与
DROP POLICY IF EXISTS "bookings_insert" ON bookings;
CREATE POLICY "bookings_insert" ON bookings
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- 7. bookings.points_used カラム追加（v8.6で設計済みだが未適用だった）
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS points_used INT DEFAULT 0;

-- 8. GRANT: テーブル権限の明示的付与
GRANT SELECT ON facility_profiles TO authenticated;
GRANT SELECT ON facility_menus TO authenticated;
GRANT SELECT ON facility_photos TO authenticated;
GRANT SELECT ON facility_reviews TO authenticated;
GRANT SELECT ON facility_inquiries TO authenticated;
GRANT INSERT ON bookings TO anon, authenticated;

-- 9. PostgRESTスキーマキャッシュリロード
NOTIFY pgrst, 'reload schema';
