-- Security audit: missing unique constraints (2026-04-18)

-- 1. nps_surveys: UNIQUE(booking_id) when booking_id IS NOT NULL
--    Prevents a user from submitting multiple NPS responses for the same booking
--    (current constraint is monthly per user+facility, which still allows booking_id duplication)
CREATE UNIQUE INDEX IF NOT EXISTS idx_nps_surveys_booking_id_unique
  ON nps_surveys(booking_id)
  WHERE booking_id IS NOT NULL;

-- 2. referral_uses: admin/service SELECT policy is missing (referral_uses has INSERT only).
--    Add a SELECT policy so platform admins can audit referral data.
--    (UNIQUE(referred_user_id) is already present from 20260405_referral_program.sql
--     and re-asserted in 20260418_security_audit_fixes.sql)
CREATE POLICY IF NOT EXISTS "referral_uses_admin_read" ON referral_uses
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 3. stripe_webhook_logs: RLS is missing entirely.
--    This table has no ALTER TABLE ... ENABLE ROW LEVEL SECURITY.
--    Enable RLS + restrict to service_role only (webhooks are written server-side).
ALTER TABLE stripe_webhook_logs ENABLE ROW LEVEL SECURITY;
-- No authenticated client should read raw webhook payloads.
-- Service role bypasses RLS automatically; deny all other access.
-- (No policy = deny all for non-service-role users — this is the safe default.)

-- 4. audit_logs: INSERT policy is missing.
--    The comment says "INSERT は service role のみ" but there's no explicit DENY policy.
--    With RLS enabled and no INSERT policy for authenticated/anon roles,
--    PostgreSQL denies INSERT by default — this is correct. Document intent explicitly.
COMMENT ON TABLE audit_logs IS
  '重要操作の監査ログ。90日で自動削除。'
  'INSERT: service_role のみ（RLSポリシーなし = 非serviceロールは全拒否）。'
  'SELECT: admin ロールまたは同一 facility_id の施設メンバー。';

-- 5. telehealth_sessions: staff role can READ but telehealth_own (user) policy
--    does not cover INSERT — users cannot self-schedule.
--    This is intentional (admin creates sessions); add a comment.
COMMENT ON TABLE telehealth_sessions IS
  'テレヘルス/オンライン相談セッション。'
  'INSERT/UPDATE は施設スタッフ（role: owner/admin/staff）のみ。'
  'SELECT は本人（user_id）または施設メンバー。';
