-- Idempotency columns to prevent duplicate cron notifications

-- review-request cron: claim before sending to prevent double email+LINE
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS review_request_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS bookings_review_request_sent_idx
  ON bookings (review_request_sent_at)
  WHERE review_request_sent_at IS NULL;

-- onboarding-followup cron: one email per facility
ALTER TABLE facility_profiles
  ADD COLUMN IF NOT EXISTS onboarding_email_sent_at TIMESTAMPTZ;

-- favorites-digest cron: one digest per user per ISO week
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS favorites_digest_sent_week TEXT;
