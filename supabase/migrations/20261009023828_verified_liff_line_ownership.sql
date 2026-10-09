BEGIN;
DO $$ BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'CareLink database required'; END IF;
END $$;

-- Earlier own UPDATE policies permitted client-controlled LINE identities.
-- Existing rows are not retrospectively provider proof, including non-NULL owners.
ALTER TABLE public.line_user_links ADD COLUMN proof_version smallint,
  ADD COLUMN verified_at timestamptz;
ALTER TABLE public.line_user_links ADD CONSTRAINT line_link_provider_proof_complete CHECK (
  (proof_version IS NULL AND verified_at IS NULL)
  OR (proof_version IS NOT NULL AND proof_version=1 AND verified_at IS NOT NULL AND user_id IS NOT NULL)
);
REVOKE INSERT,UPDATE ON public.line_user_links FROM PUBLIC,anon,authenticated;

-- Preserve every other existing profile column privilege. A browser cannot
-- create/change a LINE identity through its own editable profile row.
CREATE FUNCTION public.guard_client_line_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF current_user IN ('anon','authenticated') AND
    ((TG_OP='INSERT' AND NEW.line_user_id IS NOT NULL)
      OR (TG_OP='UPDATE' AND NEW.line_user_id IS DISTINCT FROM OLD.line_user_id)) THEN
    RAISE EXCEPTION 'LINE_IDENTITY_REQUIRES_PROVIDER_PROOF';
  END IF;
  IF current_user='service_role' AND NEW.line_user_id IS NOT NULL AND
    (TG_OP='INSERT' OR NEW.line_user_id IS DISTINCT FROM OLD.line_user_id) AND NOT EXISTS(
      SELECT 1 FROM public.line_user_links l WHERE l.user_id=NEW.id AND l.line_user_id=NEW.line_user_id
        AND l.proof_version=1 AND l.verified_at IS NOT NULL
    ) THEN RAISE EXCEPTION 'LINE_IDENTITY_REQUIRES_PROVIDER_PROOF'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER profiles_line_identity_proof BEFORE INSERT OR UPDATE OF line_user_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_client_line_identity();
REVOKE ALL ON FUNCTION public.guard_client_line_identity() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.guard_verified_line_binding() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF OLD.proof_version=1 AND OLD.verified_at IS NOT NULL AND
    (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.line_user_id IS DISTINCT FROM OLD.line_user_id
      OR NEW.proof_version IS DISTINCT FROM OLD.proof_version OR NEW.verified_at IS DISTINCT FROM OLD.verified_at) THEN
    RAISE EXCEPTION 'LINE_VERIFIED_BINDING_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER line_verified_binding_identity BEFORE UPDATE ON public.line_user_links
  FOR EACH ROW EXECUTE FUNCTION public.guard_verified_line_binding();
REVOKE ALL ON FUNCTION public.guard_verified_line_binding() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.bind_verified_liff_account_atomic(p_actor_id uuid,p_line_user_id text)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE current_line text; link_owner uuid; link_id uuid;
BEGIN
  IF p_actor_id IS NULL OR p_line_user_id IS NULL OR p_line_user_id !~ '^[A-Za-z0-9_-]{1,128}$' THEN
    RAISE EXCEPTION 'LINE_LINK_INPUT_INVALID';
  END IF;
  PERFORM public.lock_booking_account(p_actor_id);
  SELECT p.line_user_id INTO current_line FROM public.profiles p WHERE p.id=p_actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LINE_LINK_PROFILE_UNAVAILABLE'; END IF;
  -- Changing an existing different binding would be an unlink/relink operation,
  -- which is not authorized by this additive verified-link migration.
  IF current_line IS NOT NULL AND current_line<>p_line_user_id THEN RETURN 'conflict'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('carelink-line-binding:'||p_line_user_id,0));
  IF EXISTS(SELECT 1 FROM public.profiles p WHERE p.line_user_id=p_line_user_id AND p.id<>p_actor_id)
    OR EXISTS(SELECT 1 FROM public.line_user_links l WHERE l.user_id=p_actor_id AND l.line_user_id<>p_line_user_id)
    THEN RETURN 'conflict'; END IF;
  SELECT l.id,l.user_id INTO link_id,link_owner FROM public.line_user_links l
    WHERE l.line_user_id=p_line_user_id FOR UPDATE;
  IF FOUND AND link_owner IS NOT NULL AND link_owner<>p_actor_id THEN RETURN 'conflict'; END IF;
  IF link_id IS NULL THEN
    INSERT INTO public.line_user_links(user_id,line_user_id,proof_version,verified_at)
      VALUES(p_actor_id,p_line_user_id,1,clock_timestamp());
  ELSE
    UPDATE public.line_user_links SET user_id=p_actor_id,proof_version=1,
      verified_at=coalesce(verified_at,clock_timestamp()) WHERE id=link_id;
  END IF;
  UPDATE public.profiles SET line_user_id=p_line_user_id,updated_at=clock_timestamp() WHERE id=p_actor_id;
  RETURN 'linked';
EXCEPTION WHEN unique_violation THEN
  -- The entire function block rolls back; neither half remains linked.
  RETURN 'conflict';
END $$;
REVOKE ALL ON FUNCTION public.bind_verified_liff_account_atomic(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bind_verified_liff_account_atomic(uuid,text) TO service_role;

-- Only admin-issued app_metadata can recover a LINE-only account after a lost
-- createUser/binding response. Public user_metadata and an email match cannot.
CREATE FUNCTION public.find_trusted_line_auth_user(p_line_user_id text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE candidates uuid[];
BEGIN
  SELECT array_agg(candidate.id) INTO candidates FROM (
    SELECT u.id FROM auth.users u WHERE
      u.raw_app_meta_data->>'carelink_line_identity_version'='1'
      AND u.raw_app_meta_data->>'carelink_line_user_id'=p_line_user_id
    ORDER BY u.id LIMIT 2
  ) candidate;
  IF cardinality(candidates)>1 THEN RAISE EXCEPTION 'LINE_AUTH_IDENTITY_AMBIGUOUS'; END IF;
  RETURN candidates[1];
END;
$$;
REVOKE ALL ON FUNCTION public.find_trusted_line_auth_user(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.find_trusted_line_auth_user(text) TO service_role;
CREATE FUNCTION public.line_identity_requires_reconfirmation(p_line_user_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.line_user_id=p_line_user_id)
    OR EXISTS(SELECT 1 FROM public.line_user_links l WHERE l.line_user_id=p_line_user_id AND l.user_id IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION public.line_identity_requires_reconfirmation(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.line_identity_requires_reconfirmation(text) TO service_role;
-- Supabase owns auth.users. Its migration role may read the table but cannot
-- create indexes on it. External Auth creation is not one database transaction;
-- ambiguous admin markers fail closed instead of selecting an arbitrary row.

-- Filter unverifiable LINE-only candidates before the cron batch limit. An old
-- unverified prefix must not keep eligible recipients outside every next run.
DO $$ DECLARE definition text; old_join text := '  LEFT JOIN public.profiles p ON p.id = b.user_id';
  old_candidate text := 'p.line_user_id IS NOT NULL AND p.line_user_id <> ''''';
BEGIN
  SELECT pg_get_functiondef('public.pending_booking_reminders(date)'::regprocedure) INTO definition;
  IF position(old_join IN definition)=0 OR (length(definition)-length(replace(definition,old_candidate,'')))/length(old_candidate)<>2 THEN
    RAISE EXCEPTION 'LINE_REMINDER_PROOF_FORWARD_ANCHOR_MISMATCH';
  END IF;
  definition:=replace(definition,old_join,old_join||chr(10)||'  LEFT JOIN public.line_user_links l ON l.user_id=b.user_id AND l.line_user_id=p.line_user_id AND l.proof_version=1 AND l.verified_at IS NOT NULL');
  definition:=replace(definition,old_candidate,'l.user_id IS NOT NULL');
  EXECUTE definition;
END $$;
COMMIT;
