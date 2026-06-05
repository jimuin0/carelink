-- バグ12 根本修正：施設メンバー(owner/admin/staff)が自施設の掲載データを
-- status(draft/published/suspended)に関わらず参照できるようにする。
--
-- 背景:
--   既存の facility_profiles SELECT ポリシーは「status='published'」のみ許可。
--   かつ 20260406_rls_authenticated_fixes.sql は PostgreSQL 非対応の
--   `CREATE POLICY IF NOT EXISTS` を使用しており適用失敗していた可能性が高い。
--   このため draft/suspended 施設の管理画面(掲載管理ボード)が browser client 経由の
--   SELECT で空になる。書き込みは service-role API のため通るが、表示が壊れる。
--
-- 方針: 追加のみ(USINGで許可を付与)。既存ポリシーは削除・変更しない。再実行可能。

-- facility_profiles：自施設を参照可
DROP POLICY IF EXISTS "Members read own facility" ON facility_profiles;
CREATE POLICY "Members read own facility" ON facility_profiles
  FOR SELECT TO authenticated
  USING (id IN (SELECT facility_id FROM facility_members WHERE user_id = auth.uid()));

-- 子テーブル：自施設配下の掲載データを status に関わらず参照可
DROP POLICY IF EXISTS "Members read own staff" ON staff_profiles;
CREATE POLICY "Members read own staff" ON staff_profiles
  FOR SELECT TO authenticated
  USING (facility_id IN (SELECT facility_id FROM facility_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Members read own photos" ON facility_photos;
CREATE POLICY "Members read own photos" ON facility_photos
  FOR SELECT TO authenticated
  USING (facility_id IN (SELECT facility_id FROM facility_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Members read own menus" ON facility_menus;
CREATE POLICY "Members read own menus" ON facility_menus
  FOR SELECT TO authenticated
  USING (facility_id IN (SELECT facility_id FROM facility_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Members read own coupons" ON coupons;
CREATE POLICY "Members read own coupons" ON coupons
  FOR SELECT TO authenticated
  USING (facility_id IN (SELECT facility_id FROM facility_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Members read own blog" ON blog_posts;
CREATE POLICY "Members read own blog" ON blog_posts
  FOR SELECT TO authenticated
  USING (facility_id IN (SELECT facility_id FROM facility_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Members read own reviews" ON facility_reviews;
CREATE POLICY "Members read own reviews" ON facility_reviews
  FOR SELECT TO authenticated
  USING (facility_id IN (SELECT facility_id FROM facility_members WHERE user_id = auth.uid()));

GRANT SELECT ON facility_profiles, staff_profiles, facility_photos, facility_menus, coupons, blog_posts, facility_reviews TO authenticated;
NOTIFY pgrst, 'reload schema';
