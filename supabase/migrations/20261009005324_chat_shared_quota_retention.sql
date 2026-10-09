-- Existing hourly cleanup must not reset a paid call's 24-hour quota.
-- No prompt, address, user ID or provider credential is stored here.
CREATE FUNCTION public.retain_active_chat_quota() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF OLD.key LIKE 'chat-daily:%' AND OLD.window_start >= clock_timestamp()-interval '25 hours' THEN
    RETURN NULL;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.retain_active_chat_quota() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER retain_active_chat_quota BEFORE DELETE ON public.rate_limit_buckets
  FOR EACH ROW EXECUTE FUNCTION public.retain_active_chat_quota();

CREATE FUNCTION public.chat_quota_retention_version() RETURNS int
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT CASE WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid='public.rate_limit_buckets'::regclass AND NOT t.tgisinternal
      AND t.tgname='retain_active_chat_quota' AND t.tgenabled IN ('O','A')
      AND t.tgtype=11 AND t.tgfoid='public.retain_active_chat_quota()'::regprocedure)
    THEN 1 ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public.chat_quota_retention_version() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.chat_quota_retention_version() TO service_role;
