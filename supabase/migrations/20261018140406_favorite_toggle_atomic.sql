-- Serialize a user's toggle, including the initially absent row. Never infer
-- absence from a failed read or mutate after the facility becomes unpublished.
CREATE FUNCTION public.toggle_user_favorite_atomic(p_actor_id uuid, p_facility_id uuid, p_desired boolean DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE removed_id uuid;
BEGIN
 IF p_actor_id IS NULL OR p_facility_id IS NULL THEN
  RAISE EXCEPTION 'INVALID_FAVORITE_SCOPE' USING ERRCODE='22023';
 END IF;
 PERFORM public.lock_booking_account(p_actor_id);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('favorite:'||p_actor_id::text||':'||p_facility_id::text,0));
 PERFORM 1 FROM public.facility_profiles WHERE id=p_facility_id AND status='published' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FAVORITE_FACILITY_UNAVAILABLE' USING ERRCODE='P0002'; END IF;
 IF p_desired IS true THEN
  INSERT INTO public.favorites(user_id,facility_id) VALUES(p_actor_id,p_facility_id)
   ON CONFLICT(user_id,facility_id) DO NOTHING;
  RETURN true;
 END IF;
 DELETE FROM public.favorites WHERE user_id=p_actor_id AND facility_id=p_facility_id RETURNING id INTO removed_id;
 IF p_desired IS false THEN RETURN false; END IF;
 IF FOUND THEN RETURN false; END IF;
 INSERT INTO public.favorites(user_id,facility_id) VALUES(p_actor_id,p_facility_id);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.toggle_user_favorite_atomic(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_user_favorite_atomic(uuid,uuid,boolean) TO service_role;
-- Existing own-row SELECT/RLS remains. All writes must share the same lock.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.favorites FROM PUBLIC,anon,authenticated;
