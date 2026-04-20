-- Security fix: restrict facility_inquiries SELECT to facility members only.
--
-- The existing "auth_read_inquiries" policy (USING true, TO authenticated) allowed
-- any logged-in user to read all customer inquiries from any facility,
-- exposing name, email, phone, and message content.
--
-- Fix: drop the broad policy and replace with a facility-member-scoped one.

DROP POLICY IF EXISTS "auth_read_inquiries" ON facility_inquiries;

CREATE POLICY "facility_inquiries_member_read" ON facility_inquiries
  FOR SELECT
  USING (
    facility_id IN (
      SELECT facility_id FROM facility_members
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'admin')
    )
  );
