-- Security fix: remove overbroad INSERT policy on referral_uses.
--
-- "Referral uses insert" WITH CHECK(true) allows any authenticated user to
-- directly INSERT rows into referral_uses via the anon key, bypassing the
-- API's validation (code verification, self-referral check, point award).
--
-- A user could insert a fake referral_use row with arbitrary referrer_user_id,
-- permanently consuming their UNIQUE(referred_user_id) slot without going
-- through the API — blocking any legitimate future referral for that account.
--
-- All writes are done via service_role (adminSupabase) in /api/referral.
-- The INSERT policy was dead code that only added risk.

DROP POLICY IF EXISTS "Referral uses insert" ON referral_uses;

-- referral_codes: "Public read codes" FOR SELECT USING(true) exposes all
-- referral codes together with their referrer user_id to any anon client.
-- Codes are meant to be individually shared, not bulk-enumerable with owner IDs.
-- The API (/api/referral GET+POST) uses service_role for all lookups.
-- "Users can read own code" (USING auth.uid() = user_id) is sufficient for
-- any future direct-client access.

DROP POLICY IF EXISTS "Public read codes" ON referral_codes;

-- No INSERT policy needed on referral_uses for any client role.
-- All writes use service_role (adminSupabase in /api/referral).
