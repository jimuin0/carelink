-- Close RPC entry points that anonymous and signed-in callers never need.
--
-- 1. Page-view counters: the browser called record_facility_page_view directly
--    as anon with no rate limit or publish check, so anyone could inflate view
--    counts and the funnel table. Views are now recorded by
--    POST /api/facilities/[id]/view (CSRF, per-IP and per-facility limits,
--    published only) through service_role. increment_view_count has no caller.
-- 2. Trigger-only SECURITY DEFINER functions were callable through
--    /rest/v1/rpc. PostgreSQL does not check EXECUTE when firing a trigger, so
--    revoking it does not affect the triggers.
-- 3. update_waitlist_updated_at had a role-mutable search_path.
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

REVOKE EXECUTE ON FUNCTION public.record_facility_page_view(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_view_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_facility_page_view(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_view_count(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_log_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_log_new_salon() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_facility_rating() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_set_review_verified_visit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_waitlist_updated_at() FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.update_waitlist_updated_at() SET search_path = '';
