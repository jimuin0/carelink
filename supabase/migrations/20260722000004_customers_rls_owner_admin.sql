-- 【監査L4・恒久根治のDDL部】customers / customer_visits の RLS を owner/admin ロールに限定する。
-- 現状の RLS（customers=20260620000003 / customer_visits=20260323000004）は「施設メンバーであること」
-- のみを検証しロールを問わないため、将来 staff/viewer 会員に対し機微な顧客台帳への直接 CRUD を
-- 許す潜在的なテナント内権限逸脱がある。アプリ層は owner/admin のみを想定し、書き込みAPIは
-- service_role で RLS を迂回するため、この厳格化は通常運用に影響しない（読み取り整合のみ最小権限化）。
-- EXISTS 条件に role IN ('owner','admin') を足すだけ（他は無変更）。

DROP POLICY IF EXISTS "customers_member_read"   ON customers;
DROP POLICY IF EXISTS "customers_member_insert" ON customers;
DROP POLICY IF EXISTS "customers_member_update" ON customers;
DROP POLICY IF EXISTS "customers_member_delete" ON customers;
CREATE POLICY "customers_member_read"   ON customers FOR SELECT USING (
  EXISTS (SELECT 1 FROM facility_members WHERE facility_id = customers.facility_id AND user_id = auth.uid() AND role IN ('owner','admin')));
CREATE POLICY "customers_member_insert" ON customers FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM facility_members WHERE facility_id = customers.facility_id AND user_id = auth.uid() AND role IN ('owner','admin')));
CREATE POLICY "customers_member_update" ON customers FOR UPDATE USING (
  EXISTS (SELECT 1 FROM facility_members WHERE facility_id = customers.facility_id AND user_id = auth.uid() AND role IN ('owner','admin')));
CREATE POLICY "customers_member_delete" ON customers FOR DELETE USING (
  EXISTS (SELECT 1 FROM facility_members WHERE facility_id = customers.facility_id AND user_id = auth.uid() AND role IN ('owner','admin')));

DROP POLICY IF EXISTS "customer_visits_member_read"   ON customer_visits;
DROP POLICY IF EXISTS "customer_visits_member_insert" ON customer_visits;
CREATE POLICY "customer_visits_member_read"   ON customer_visits FOR SELECT USING (
  EXISTS (SELECT 1 FROM facility_members fm WHERE fm.facility_id = customer_visits.facility_id AND fm.user_id = auth.uid() AND fm.role IN ('owner','admin')));
CREATE POLICY "customer_visits_member_insert" ON customer_visits FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM facility_members fm WHERE fm.facility_id = customer_visits.facility_id AND fm.user_id = auth.uid() AND fm.role IN ('owner','admin')));
