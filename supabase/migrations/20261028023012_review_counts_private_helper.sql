-- Keep the public RPC's signature and results, but put the privileged
-- aggregation outside schemas exposed by PostgREST. Never add this schema to
-- the API's exposed schemas. The helper remains
-- intentionally callable by the public RPC and must return no voter IDs.
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = pg_catalog.to_regprocedure('public.get_review_helpful_counts(uuid[])')
      AND p.prosecdef AND pg_catalog.md5(p.prosrc) = 'f02a0d2cb58f8cddc2c00e91abcff10a'
  ) THEN
    RAISE EXCEPTION 'unexpected review count function; stop and review';
  END IF;
END
$guard$;
CREATE SCHEMA carelink_review_private;
REVOKE ALL ON SCHEMA carelink_review_private FROM PUBLIC;
GRANT USAGE ON SCHEMA carelink_review_private TO anon, authenticated, service_role;

CREATE FUNCTION carelink_review_private.get_review_helpful_counts(p_review_ids uuid[])
RETURNS TABLE(review_id uuid, helpful_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT h.review_id, count(*)::integer
  FROM public.review_helpful h
  JOIN public.facility_reviews r ON r.id = h.review_id
  JOIN public.facility_profiles f ON f.id = r.facility_id
  WHERE h.review_id = ANY (p_review_ids)
    AND r.status = 'published'
    AND r.is_flagged = false
    AND f.status = 'published'
  GROUP BY h.review_id
$$;
REVOKE ALL ON FUNCTION carelink_review_private.get_review_helpful_counts(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION carelink_review_private.get_review_helpful_counts(uuid[]) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_review_helpful_counts(p_review_ids uuid[])
RETURNS TABLE(review_id uuid, helpful_count integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT * FROM carelink_review_private.get_review_helpful_counts(p_review_ids)
$$;
