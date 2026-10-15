-- Pin lookup to trusted schemas; keep function bodies, invoker security and
-- execution grants unchanged. This migration does not run any cleanup function.
-- The explicitly held waitlist implementation is excluded.
DO $$ BEGIN
 IF has_schema_privilege('anon','public','CREATE') OR has_schema_privilege('authenticated','public','CREATE')
 OR has_schema_privilege('anon','extensions','CREATE') OR has_schema_privilege('authenticated','extensions','CREATE') THEN
 RAISE EXCEPTION 'FUNCTION_PATH_REQUIRES_TRUSTED_SCHEMAS'; END IF;
END $$;
ALTER FUNCTION public.update_feature_flags_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.sync_facility_location() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.update_platform_blog_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.update_service_packages_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.update_area_seo_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.update_customers_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.cleanup_old_audit_logs() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.update_treatment_records_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.update_intake_template_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.update_threads_credentials_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.update_treatment_plans_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.cleanup_old_cron_logs() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.set_hpb_menu_durations_updated_at() SET search_path = public, extensions, pg_temp;
ALTER FUNCTION public.search_facilities_nearby(double precision,double precision,double precision,text,integer,text,text[]) SET search_path = public, extensions, pg_temp;
