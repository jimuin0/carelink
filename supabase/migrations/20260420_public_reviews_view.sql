-- Security: create public_reviews security-definer view to hide reviewer_ip.
--
-- PostgreSQL RLS cannot restrict individual columns; any anon-key query with
-- SELECT * on facility_reviews returns reviewer_ip even though it is PII.
--
-- This view exposes only the columns needed for public display.
-- SECURITY DEFINER means the view runs as its owner (postgres), which holds
-- the SELECT grant — anon/authenticated users see only what the view projects.
--
-- Usage: frontend public queries use public_reviews instead of facility_reviews.
-- Facility-member admin queries continue to use the base table (service_role).

CREATE OR REPLACE VIEW public_reviews
  WITH (security_invoker = false)  -- SECURITY DEFINER behaviour for views
AS
  SELECT
    id,
    facility_id,
    reviewer_name,
    rating,
    rating_skill,
    rating_service,
    rating_atmosphere,
    rating_cleanliness,
    rating_explanation,
    comment,
    photo_urls,
    is_verified_visit,
    status,
    user_id,
    created_at
  FROM facility_reviews
  WHERE status = 'published';

-- Grant SELECT on the view to all roles.
-- The underlying table's RLS still applies for direct access,
-- but via this view anon clients cannot read reviewer_ip.
GRANT SELECT ON public_reviews TO anon, authenticated;

-- Drop the anon direct-table SELECT policy now that the view is in place.
-- Anon queries should go through public_reviews, not facility_reviews directly.
DROP POLICY IF EXISTS "Public read published reviews" ON facility_reviews;
