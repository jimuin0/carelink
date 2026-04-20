-- Security fix: remove overbroad policies on email_unsubscribe_tokens.
--
-- "anon_read_token" FOR SELECT USING(true) exposes all unsubscribe tokens
-- (and their associated user_ids) to any anon-key client, enabling:
--   1. Enumeration of all token↔user_id associations (PII linkage)
--   2. Token harvesting for targeted unsubscription of arbitrary users
--
-- "anon_update_token" FOR UPDATE USING(true) WITH CHECK(true) allows any
-- anon-key client to directly update any token row — e.g., marking tokens
-- as used to block legitimate unsubscribes.
--
-- All reads and writes in /api/unsubscribe use service_role, which bypasses
-- RLS. These policies were dead code for the API path and only added risk.

DROP POLICY IF EXISTS "anon_read_token" ON email_unsubscribe_tokens;
DROP POLICY IF EXISTS "anon_update_token" ON email_unsubscribe_tokens;

-- No client-role access is needed. All operations are service_role-only.
