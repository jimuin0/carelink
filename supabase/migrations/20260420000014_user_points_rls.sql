-- user_points RLS: restrict INSERT/UPDATE/DELETE to service_role only.
--
-- user_points was already RLS-enabled with a SELECT policy (user sees own rows).
-- No INSERT/UPDATE/DELETE policy existed, meaning authenticated clients
-- (anon key + session) could not write — causing silent failures in booking
-- completion (point award) and booking deduction routes.
--
-- Design intent:
--   - Users READ their own rows (existing policy)
--   - All WRITES go through service_role (server-side only)
--   - This prevents users from granting themselves points via direct API calls
--
-- Note: all write paths (booking route CAS, booking/complete, review bonus,
-- birthday cron, referral) now use createServiceRoleClient() which bypasses RLS.

-- Explicitly deny INSERT/UPDATE/DELETE for authenticated role
-- (no policy = deny; these are documentation-as-code in case a policy is added later)
-- Nothing to ALTER here — the absence of write policies is intentional.
-- This migration documents the design decision and serves as a marker.

-- Facility members can read points of their customers (for admin views)
-- NOTE: `CREATE POLICY IF NOT EXISTS` は未対応構文（42601）。DROP+CREATE で冪等化。
DROP POLICY IF EXISTS "user_points_facility_member_read" ON user_points;
CREATE POLICY "user_points_facility_member_read" ON user_points
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM bookings b
      JOIN facility_members fm ON fm.facility_id = b.facility_id
      WHERE b.user_id = user_points.user_id
        AND fm.user_id = auth.uid()
        AND fm.role IN ('owner', 'admin')
      LIMIT 1
    )
  );
