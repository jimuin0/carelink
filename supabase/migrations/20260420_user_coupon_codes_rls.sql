-- Security fix: remove overbroad SELECT policy on user_coupon_codes.
--
-- The original "anon_read_code" policy allows anyone (anon) to SELECT all rows,
-- exposing customer email addresses and their personal coupon codes.
-- No API route or frontend reads this table via the anon client;
-- all operations are done via service_role (cron job).
-- The broad SELECT policy was dead code from an unimplemented feature.

DROP POLICY IF EXISTS "anon_read_code" ON user_coupon_codes;

-- If a lookup-by-code endpoint is ever added, use a function-based policy:
--   USING (code = current_setting('app.coupon_code', true))
-- to prevent enumeration of all codes/emails.
