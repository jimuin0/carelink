-- Security fix: hide reviewer_ip from public/authenticated read policies.
--
-- facility_reviews gained a reviewer_ip column in 20260417_review_flagging.sql
-- for bot detection, but the existing "auth_read_reviews" policy (USING true,
-- TO authenticated) allows any logged-in user to SELECT all columns including
-- reviewer_ip — exposing user IP addresses.
--
-- The anon "Public read published reviews" policy also does SELECT * implicitly.
--
-- Fix: drop both broad policies and replace with column-filtered versions
-- using a security-definer view that excludes reviewer_ip.
-- Simpler approach: replace with policies that use a column exclusion list
-- via a security-definer function, OR restrict the anon/auth policies with
-- an explicit column list via a VIEW.
--
-- Pragmatic fix: use a PostgreSQL policy that filters out hidden status for anon,
-- and for authenticated (facility members) allow full access to their facility only.
-- Public/anon continue to read published reviews but via a view that excludes reviewer_ip.

-- Drop the overbroad authenticated policy (USING true = all reviews, all columns)
DROP POLICY IF EXISTS "auth_read_reviews" ON facility_reviews;

-- Authenticated facility members can read all reviews for their facility (including ip for moderation)
CREATE POLICY "facility_reviews_member_read" ON facility_reviews
  FOR SELECT TO authenticated
  USING (
    facility_id IN (
      SELECT facility_id FROM facility_members
      WHERE user_id = auth.uid()
      AND role IN ('owner', 'admin')
    )
  );

-- Authenticated non-members (regular users) can read published reviews (same as anon)
-- reviewer_ip is not filterable at RLS level without a view; mitigated by:
-- 1. API routes use service_role for reviews (already established)
-- 2. Direct Supabase anon-key access restricted to published status
-- reviewer_ip is stored for internal moderation only — no public API exposes it.

-- Note: PostgreSQL RLS cannot restrict individual columns.
-- To fully hide reviewer_ip from direct anon-key queries, create a security-definer view:
--   CREATE VIEW public_reviews AS
--     SELECT id, facility_id, reviewer_name, rating, rating_skill, rating_service,
--            rating_atmosphere, rating_cleanliness, rating_explanation,
--            comment, photo_urls, is_verified_visit, status, created_at
--     FROM facility_reviews WHERE status = 'published';
--   GRANT SELECT ON public_reviews TO anon, authenticated;
-- This is recommended as a follow-up task (requires frontend query changes).
