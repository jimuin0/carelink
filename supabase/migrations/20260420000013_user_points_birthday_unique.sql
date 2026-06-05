-- Fix TOCTOU race in birthday-coupon cron.
--
-- The cron reads user_points to check for existing birthday points (reason='birthday'),
-- then inserts if none found. Two concurrent cron executions can both pass the read
-- check and both insert, awarding 200 points instead of 100.
--
-- Fix: change reason to 'birthday_YYYY' (year-scoped) + add partial unique index
-- so a second insert for the same user+year fails with a unique constraint violation,
-- which the application code treats as "already processed" (idempotent).

-- Partial unique index: only applies to birthday_* reason rows.
-- Uses text equality on the full reason string (e.g. 'birthday_2026').
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_points_birthday_year
  ON user_points(user_id, reason)
  WHERE reason LIKE 'birthday_%';
