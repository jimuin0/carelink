-- Persist cancellation independently of the token row, including when no token
-- exists yet. Only trusted server routes may read/write or execute these RPCs.
CREATE TABLE public.google_calendar_oauth_intents (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nonce_hash text,
  expires_at timestamptz,
  CHECK ((nonce_hash IS NULL) = (expires_at IS NULL)),
  CHECK (nonce_hash IS NULL OR nonce_hash ~ '^[0-9a-f]{64}$')
);
ALTER TABLE public.google_calendar_oauth_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.google_calendar_oauth_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_calendar_oauth_intents TO service_role;

CREATE FUNCTION public.begin_google_calendar_oauth(p_actor_id uuid, p_nonce_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_actor_id IS NULL OR p_nonce_hash IS NULL OR p_nonce_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'INVALID_CALENDAR_OAUTH_INTENT' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-google-connection:' || p_actor_id::text, 0));
  INSERT INTO public.google_calendar_oauth_intents(user_id, nonce_hash, expires_at)
  VALUES (p_actor_id, p_nonce_hash, pg_catalog.clock_timestamp() + interval '10 minutes')
  ON CONFLICT (user_id) DO UPDATE SET nonce_hash = EXCLUDED.nonce_hash, expires_at = EXCLUDED.expires_at;
  RETURN true;
END;
$$;

CREATE FUNCTION public.disconnect_google_calendar(p_actor_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_actor_id IS NULL THEN RAISE EXCEPTION 'INVALID_CALENDAR_ACTOR' USING ERRCODE = '22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-google-connection:' || p_actor_id::text, 0));
  INSERT INTO public.google_calendar_oauth_intents(user_id, nonce_hash, expires_at)
  VALUES (p_actor_id, NULL, NULL)
  ON CONFLICT (user_id) DO UPDATE SET nonce_hash = NULL, expires_at = NULL;
  DELETE FROM public.google_calendar_tokens WHERE user_id = p_actor_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.save_google_calendar_oauth(
  p_actor_id uuid, p_nonce_hash text, p_observed_token_id uuid,
  p_observed_updated_at timestamptz, p_access_token text, p_refresh_token text,
  p_expires_at timestamptz, p_scope text
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_nonce text;
  v_expires timestamptz;
  v_token public.google_calendar_tokens%ROWTYPE;
  v_has_token boolean;
BEGIN
  IF p_actor_id IS NULL OR p_nonce_hash IS NULL OR p_nonce_hash !~ '^[0-9a-f]{64}$'
    OR p_access_token IS NULL OR p_access_token = '' OR p_refresh_token IS NULL OR p_refresh_token = ''
    OR p_expires_at IS NULL OR p_expires_at <= pg_catalog.clock_timestamp()
    OR ((p_observed_token_id IS NULL) <> (p_observed_updated_at IS NULL)) THEN
    RAISE EXCEPTION 'INVALID_CALENDAR_OAUTH_SAVE' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-google-connection:' || p_actor_id::text, 0));
  SELECT nonce_hash, expires_at INTO v_nonce, v_expires
    FROM public.google_calendar_oauth_intents WHERE user_id = p_actor_id FOR UPDATE;
  IF NOT FOUND OR v_nonce IS DISTINCT FROM p_nonce_hash OR v_expires IS NULL
    OR v_expires <= pg_catalog.clock_timestamp() THEN RETURN false; END IF;
  SELECT * INTO v_token FROM public.google_calendar_tokens WHERE user_id = p_actor_id FOR UPDATE;
  v_has_token := FOUND;
  IF v_has_token THEN
    IF v_token.id IS DISTINCT FROM p_observed_token_id
      OR v_token.updated_at IS DISTINCT FROM p_observed_updated_at THEN RETURN false; END IF;
    UPDATE public.google_calendar_tokens SET access_token = p_access_token, refresh_token = p_refresh_token,
      expires_at = p_expires_at, scope = p_scope,
      updated_at = GREATEST(pg_catalog.clock_timestamp(), v_token.updated_at + interval '1 microsecond')
      WHERE id = v_token.id AND user_id = p_actor_id;
  ELSE
    IF p_observed_token_id IS NOT NULL THEN RETURN false; END IF;
    INSERT INTO public.google_calendar_tokens(user_id, access_token, refresh_token, expires_at, scope)
      VALUES (p_actor_id, p_access_token, p_refresh_token, p_expires_at, p_scope);
  END IF;
  UPDATE public.google_calendar_oauth_intents SET nonce_hash = NULL, expires_at = NULL WHERE user_id = p_actor_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.begin_google_calendar_oauth(uuid,text), public.disconnect_google_calendar(uuid), public.save_google_calendar_oauth(uuid,text,uuid,timestamptz,text,text,timestamptz,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_google_calendar_oauth(uuid,text), public.disconnect_google_calendar(uuid), public.save_google_calendar_oauth(uuid,text,uuid,timestamptz,text,text,timestamptz,text) TO service_role;
