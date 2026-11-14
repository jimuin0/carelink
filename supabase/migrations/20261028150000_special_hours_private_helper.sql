-- Keep the public RPC's signature and results, but put the privileged read of
-- facility_special_hours outside schemas exposed by PostgREST (same shape as
-- 20261028023012_review_counts_private_helper.sql). Never add this schema to
-- the API's exposed schemas. facility_card_view keeps calling the public RPC.
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = pg_catalog.to_regprocedure('public.published_special_hours(uuid)')
      AND p.prosecdef AND pg_catalog.md5(p.prosrc) = 'e1c4bfb69d0ca2ca4eb1ca420f8ee5bb'
  ) THEN
    RAISE EXCEPTION 'unexpected special hours function; stop and review';
  END IF;
END
$guard$;
CREATE SCHEMA carelink_schedule_private;
REVOKE ALL ON SCHEMA carelink_schedule_private FROM PUBLIC;
GRANT USAGE ON SCHEMA carelink_schedule_private TO anon, authenticated, service_role;

-- Publicly visible schedule facts only, and only for published facilities.
CREATE FUNCTION carelink_schedule_private.published_special_hours(p_facility_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT jsonb_build_object('closed_dates',s.closed_dates,'close_on_public_holidays',s.close_on_public_holidays,
   'reception_cutoff_minutes',s.reception_cutoff_minutes)
 FROM public.facility_special_hours s JOIN public.facility_profiles f ON f.id=s.facility_id
 WHERE f.id=p_facility_id AND f.status='published';
$$;
REVOKE ALL ON FUNCTION carelink_schedule_private.published_special_hours(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION carelink_schedule_private.published_special_hours(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.published_special_hours(p_facility_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT carelink_schedule_private.published_special_hours(p_facility_id)
$$;
