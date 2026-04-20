-- Security fix: remove anon INSERT policy on facility_reviews.
--
-- "Anyone can insert reviews" FOR INSERT TO anon WITH CHECK(true) allows any
-- anon client to insert reviews directly, bypassing:
--   - reCAPTCHA v3 bot detection
--   - IP-based rate limiting (5/min per IP)
--   - reviewer_ip recording (needed for moderation/dedup)
--   - 24h duplicate submission check
--   - CSRF token validation
--
-- All review submissions go through POST /api/review, which uses service_role.
-- The policy was dead code that only enabled abuse (spam reviews, fake ratings).

DROP POLICY IF EXISTS "Anyone can insert reviews" ON facility_reviews;
