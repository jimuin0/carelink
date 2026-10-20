-- Availability RPCs are SECURITY DEFINER and were executable by anon and
-- authenticated through /rest/v1/rpc, bypassing the rate limits of
-- /api/slots and /api/availability. Those routes now call them with
-- service_role, and create_booking_atomic / change_booking_atomic call them as
-- their owner, so no API role needs EXECUTE.
-- PostGIS st_estimatedextent is owned by supabase_admin and is left to the
-- platform owner (same request as public.spatial_ref_sys).
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

REVOKE EXECUTE ON FUNCTION public.get_available_slots(uuid, uuid, date, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_month_availability(uuid, uuid[], integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_slots(uuid, uuid, date, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_month_availability(uuid, uuid[], integer, integer, integer) TO service_role;
