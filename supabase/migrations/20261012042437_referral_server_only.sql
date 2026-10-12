-- Codes are issued only by the rate-limited server API. Ownership alone must
-- not authorize a browser to choose a code or fabricate its use count.
BEGIN;
DROP POLICY IF EXISTS "Users can insert own code" ON public.referral_codes;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.referral_codes FROM PUBLIC, anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.referral_codes TO service_role;
COMMIT;
