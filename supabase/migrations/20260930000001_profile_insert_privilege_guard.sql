-- A missing own profile is recoverable, but INSERT must not grant privileges.
-- The existing UPDATE trigger is retained without modifying applied migrations.
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'CareLink database required';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.prevent_profile_insert_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    -- Client recovery may only use the unprivileged column defaults. The
    -- trusted signup trigger and service-role grants keep their existing path.
    IF NEW.role IS NOT NULL OR NEW.is_platform_admin IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'permission denied: cannot insert privileged profile'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.prevent_profile_insert_privilege_escalation()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_profile_insert_privilege_escalation()
  TO service_role;

DROP TRIGGER IF EXISTS trg_profiles_insert_privilege_guard ON public.profiles;
CREATE TRIGGER trg_profiles_insert_privilege_guard
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_insert_privilege_escalation();
