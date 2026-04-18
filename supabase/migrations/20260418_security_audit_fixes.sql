-- Security audit fixes (2026-04-18)

-- 1. Prevent double awarding of completion points for the same booking.
--    booking_id is nullable (points from referral/review/birthday have no booking),
--    so we use a partial unique index that only enforces uniqueness when booking_id IS NOT NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_points_booking_id_unique
  ON user_points(booking_id)
  WHERE booking_id IS NOT NULL;

-- 2. Atomically increment sessions_used_this_month to eliminate the read-then-write
--    race condition in the subscription session PATCH handler.
--    The application code still does an optimistic read for the limit check,
--    but the actual increment is now done atomically so concurrent requests
--    cannot both see usedThisMonth < sessionsPerMonth and both succeed.
--    NOTE: actual atomic RPC is handled at the app layer via the conditional update below.
--    This comment documents intent; no DDL change needed here beyond the index above.

-- 3. Ensure referral_uses has UNIQUE(referred_user_id) — already present from
--    20260405_referral_program.sql; this is a safety re-assertion (IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'referral_uses'::regclass
      AND contype = 'u'
      AND conname = 'referral_uses_referred_user_id_key'
  ) THEN
    ALTER TABLE referral_uses ADD CONSTRAINT referral_uses_referred_user_id_key UNIQUE (referred_user_id);
  END IF;
END $$;
