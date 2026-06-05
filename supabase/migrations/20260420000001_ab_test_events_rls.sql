-- Security fix: remove overbroad INSERT policy on ab_test_events.
--
-- "ab_test_insert" WITH CHECK(true) allows any user (including anon) to inject
-- arbitrary event rows directly via the Supabase client, skewing A/B analytics.
-- Fake impressions or conversions would corrupt experiment lift calculations.
--
-- All writes go through /api/ab-test (POST) which uses service_role.
-- The INSERT policy was dead code (service_role bypasses RLS).
-- No client-role INSERT is needed or intended.

DROP POLICY IF EXISTS "ab_test_insert" ON ab_test_events;
