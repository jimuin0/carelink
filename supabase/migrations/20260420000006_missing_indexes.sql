-- Performance: add missing indexes on high-frequency query patterns.
--
-- Identified via audit of admin/page.tsx, admin/bookings, and mypage queries.

-- bookings(facility_id, booking_date): admin dashboard "today's bookings" query
-- and calendar view both filter on both columns simultaneously.
CREATE INDEX IF NOT EXISTS idx_bookings_facility_date
  ON bookings(facility_id, booking_date);

-- bookings(facility_id, status): admin dashboard "pending bookings" count
-- and bookings list with status filter.
CREATE INDEX IF NOT EXISTS idx_bookings_facility_status
  ON bookings(facility_id, status);

-- bookings(user_id, created_at DESC): mypage bookings list, ordered by recency.
CREATE INDEX IF NOT EXISTS idx_bookings_user_created
  ON bookings(user_id, created_at DESC);

-- facility_reviews(facility_id, status): public_reviews view + admin review list
-- both filter on facility_id + status = 'published'.
CREATE INDEX IF NOT EXISTS idx_facility_reviews_facility_status
  ON facility_reviews(facility_id, status);

-- facility_members(user_id): heavily used in middleware + every admin route
-- to check membership. Already exists as idx_facility_members_user; kept for reference.
-- (Already indexed — no action needed.)

-- user_points(user_id): summed for balance checks on every booking with points.
CREATE INDEX IF NOT EXISTS idx_user_points_user_id
  ON user_points(user_id);

-- referral_uses(referred_user_id): unique constraint already creates an index.
-- (No action needed — UNIQUE implies index.)
