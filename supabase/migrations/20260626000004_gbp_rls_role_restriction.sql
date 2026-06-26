-- 2026年6月26日: gbp_posts / gbp_audit_cache の RLS ポリシーに role 絞り込みを追加（冪等・無破壊）。
--
-- 背景（事実・敵対監査 SEC-1 で確定）:
--   20260417000015_gbp_integration.sql の両ポリシーは USING 句が
--     facility_id IN (SELECT facility_id FROM facility_members WHERE user_id = auth.uid())
--   のみで role を問わず、FOR 句なし＝既定 ALL（SELECT/INSERT/UPDATE/DELETE）。
--   同種の欠陥（facility_members 相関のみ・role 無視・FOR ALL）は 20260615000002_rls_hardening_round.sql で
--   contact_replies / platform_blog_posts では是正済みだが、gbp_posts / gbp_audit_cache はその hardening の
--   取りこぼしとして残存していた。アプリ API（src/app/api/admin/gbp/*）は owner/admin に限定済みだが、
--   PostgREST 直接アクセス経路では staff ロールでも読み書きし得る（防御の二重化が崩れている）。
--
-- 修正（発症前の真の予防）:
--   両ポリシーを DROP → role IN ('owner','admin') を加えて再作成。
--   アプリは service role 経由（RLS バイパス）で動くため本変更の影響を受けず、
--   PostgREST 直アクセス経路のみがより厳格化される＝副作用なしの安全な締め直し。
--
-- 冪等性: DROP POLICY IF EXISTS → CREATE POLICY。再適用安全。

DROP POLICY IF EXISTS "facility_members_gbp_posts" ON gbp_posts;
CREATE POLICY "facility_members_gbp_posts" ON gbp_posts
  USING (
    facility_id IN (
      SELECT facility_id FROM facility_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "facility_members_gbp_audit" ON gbp_audit_cache;
CREATE POLICY "facility_members_gbp_audit" ON gbp_audit_cache
  USING (
    facility_id IN (
      SELECT facility_id FROM facility_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );
