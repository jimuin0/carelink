-- Retirement cleanup belongs to the Auth DELETE transaction. A rejected Auth
-- deletion/cleanup/FK guard cannot leave a live account with erased preferences,
-- detached business references, or an unnecessarily suspended facility.
-- This retains the previous API's 17 cleanup operations, with LINE cleanup
-- restricted to the retiring account's owned association. No booking,
-- facility, message, clinical content, or Storage object is physically removed.
CREATE FUNCTION public.cleanup_deleting_account_personal_data() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Keep the profile locked until Auth/profile CASCADE. Its self-editable
  -- line_user_id is not proof of ownership: only this link's user_id binds it
  -- to the retiring account. Other accounts' links and ambiguous NULL-user
  -- legacy follower rows remain; no LINE provider unlink is performed.
  PERFORM 1 FROM public.profiles p WHERE p.id=OLD.id FOR UPDATE;
  DELETE FROM public.line_user_links l WHERE l.user_id=OLD.id;
  DELETE FROM public.favorites WHERE user_id=OLD.id;
  DELETE FROM public.user_points WHERE user_id=OLD.id;
  DELETE FROM public.push_subscriptions WHERE user_id=OLD.id;
  DELETE FROM public.referral_codes WHERE user_id=OLD.id;
  DELETE FROM public.review_helpful WHERE user_id=OLD.id;
  DELETE FROM public.user_preferred_staff WHERE user_id=OLD.id;
  DELETE FROM public.google_calendar_tokens WHERE user_id=OLD.id;
  DELETE FROM public.user_packages WHERE user_id=OLD.id;
  DELETE FROM public.user_subscriptions WHERE user_id=OLD.id;
  UPDATE public.intake_form_responses SET user_id=NULL WHERE user_id=OLD.id;
  UPDATE public.nps_surveys SET user_id=NULL WHERE user_id=OLD.id;
  UPDATE public.booking_waitlist SET user_id=NULL WHERE user_id=OLD.id;
  UPDATE public.treatment_records SET user_id=NULL WHERE user_id=OLD.id;
  UPDATE public.treatment_plans SET user_id=NULL WHERE user_id=OLD.id;
  UPDATE public.newsletter_campaigns SET created_by=NULL WHERE created_by=OLD.id;
  UPDATE public.api_keys SET created_by=NULL WHERE created_by=OLD.id;
  RETURN OLD;
END;
$$;
-- The definer privilege is needed solely by the fixed OLD.id cleanup when
-- Supabase's existing Auth role deletes its user. No callable app RPC or new
-- Auth table/schema privilege is exposed to anon/authenticated/service_role.
REVOKE ALL ON FUNCTION public.cleanup_deleting_account_personal_data() FROM PUBLIC,anon,authenticated,service_role;

-- PostgreSQL runs same-kind triggers by name. The existing authoritative
-- active-booking guard must execute first, before any personal cleanup.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid='auth.users'::regclass
    AND t.tgname='guard_account_deletion_active_bookings' AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')
    AND t.tgfoid='public.guard_account_deletion_active_bookings()'::regprocedure
    AND (t.tgtype & 11)=11)
    THEN RAISE EXCEPTION 'ACCOUNT_ACTIVE_BOOKING_GUARD_REQUIRED'; END IF;
END $$;
CREATE TRIGGER guard_account_deletion_personal_cleanup BEFORE DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_deleting_account_personal_data();

-- Deployment gate: a new API refuses the destructive Auth call until both
-- transaction guards are installed and enabled. This exposes only an integer
-- capability marker to its trusted server, never an Auth row or deletion RPC.
CREATE FUNCTION public.account_deletion_cleanup_version() RETURNS int
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relname='users')
    AND t.tgname='guard_account_deletion_active_bookings' AND NOT t.tgisinternal
    AND t.tgfoid='public.guard_account_deletion_active_bookings()'::regprocedure AND (t.tgtype&11)=11 AND t.tgenabled IN ('O','A'))
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=(SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relname='users')
    AND t.tgname='guard_account_deletion_personal_cleanup' AND NOT t.tgisinternal
    AND t.tgfoid='public.cleanup_deleting_account_personal_data()'::regprocedure AND (t.tgtype&11)=11 AND t.tgenabled IN ('O','A'))
  THEN 1 ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public.account_deletion_cleanup_version() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_cleanup_version() TO service_role;
