-- Preserve existing public behavior; each facility can independently hide the
-- automatic status when holiday/date exceptions are not represented by hours.
DO $guard$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF;
END $guard$;
ALTER TABLE public.facility_profiles ADD COLUMN show_business_status boolean NOT NULL DEFAULT true;

-- Preserve the existing fresh-membership fence, account locks and service-only
-- ACL. Abort on source drift rather than replacing an unreviewed function.
DO $patch$
DECLARE definition text; needle text := '''features'',''regular_holiday'',''business_hours'',''booking_auto_confirm''';
  lock_line text := '  PERFORM public.lock_booking_account(p_actor_id);';
BEGIN
  definition := pg_get_functiondef('public.update_facility_settings_atomic(uuid,uuid,jsonb)'::regprocedure);
  IF md5(definition) <> '2aaac82df5d73165436bc567790be3f7'
    OR strpos(definition,needle)=0 OR strpos(definition,lock_line)=0 THEN
    RAISE EXCEPTION 'facility settings function drift';
  END IF;
  definition := replace(definition,needle,'''features'',''regular_holiday'',''business_hours'',''show_business_status'',''booking_auto_confirm''');
  definition := replace(definition,lock_line,$validation$  IF p_patch ? 'show_business_status' AND jsonb_typeof(p_patch->'show_business_status') IS DISTINCT FROM 'boolean'
    THEN RAISE EXCEPTION 'INVALID_FACILITY_PATCH'; END IF;
$validation$ || lock_line);
  EXECUTE definition;
END $patch$;
