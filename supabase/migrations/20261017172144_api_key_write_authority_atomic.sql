-- API keys can only be issued by a current owner through the server route.
-- Keep existing metadata reads compatible; direct Data API writes are forbidden.
DROP POLICY api_keys_facility_member ON public.api_keys;
CREATE POLICY api_keys_facility_member ON public.api_keys FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.facility_members m WHERE m.facility_id=api_keys.facility_id
   AND m.user_id=(SELECT auth.uid()) AND m.role IN ('owner','admin')));
REVOKE ALL ON public.api_keys FROM anon,authenticated;
GRANT SELECT ON public.api_keys TO authenticated;

CREATE FUNCTION public.manage_facility_api_key_atomic(
 p_actor_id uuid,p_facility_id uuid,p_key_id uuid,p_action text,p_values jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result_key public.api_keys%ROWTYPE;
BEGIN
 IF p_actor_id IS NULL OR p_facility_id IS NULL THEN RAISE EXCEPTION 'KEY_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('create','revoke') OR p_values IS NULL OR jsonb_typeof(p_values)<>'object'
  OR (p_action='create' AND p_key_id IS NOT NULL) OR (p_action='revoke' AND p_key_id IS NULL)
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_values) k WHERE k NOT IN ('name','key_hash','key_prefix','scopes'))
  OR (p_action='revoke' AND p_values<>'{}'::jsonb)
 THEN RAISE EXCEPTION 'INVALID_KEY_MUTATION' USING ERRCODE='22023'; END IF;
 PERFORM public.lock_booking_account(p_actor_id);
 PERFORM 1 FROM public.facility_members WHERE user_id=p_actor_id AND facility_id=p_facility_id
  AND (role='owner' OR (p_action='revoke' AND role='admin')) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'KEY_FORBIDDEN' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.facility_profiles WHERE id=p_facility_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'KEY_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF p_action='create' THEN
  IF jsonb_typeof(p_values->'name') IS DISTINCT FROM 'string'
   OR char_length(btrim(p_values->>'name')) NOT BETWEEN 1 AND 100
   OR jsonb_typeof(p_values->'key_hash') IS DISTINCT FROM 'string'
   OR (p_values->>'key_hash') !~ '^[0-9a-f]{64}$'
   OR jsonb_typeof(p_values->'key_prefix') IS DISTINCT FROM 'string'
   OR (p_values->>'key_prefix') !~ '^ck_live_[0-9a-f]{8}$'
   OR jsonb_typeof(p_values->'scopes') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'INVALID_KEY_MUTATION' USING ERRCODE='22023'; END IF;
  IF jsonb_array_length(p_values->'scopes') NOT BETWEEN 1 AND 3
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_values->'scopes') s
    WHERE jsonb_typeof(s)<>'string' OR s#>>'{}' NOT IN ('bookings:read','customers:read','reviews:read'))
   OR (SELECT count(DISTINCT s) FROM jsonb_array_elements(p_values->'scopes') s)<>jsonb_array_length(p_values->'scopes')
  THEN RAISE EXCEPTION 'INVALID_KEY_MUTATION' USING ERRCODE='22023'; END IF;
  INSERT INTO public.api_keys(facility_id,name,key_hash,key_prefix,scopes,created_by)
   VALUES(p_facility_id,btrim(p_values->>'name'),p_values->>'key_hash',p_values->>'key_prefix',
    ARRAY(SELECT jsonb_array_elements_text(p_values->'scopes')),p_actor_id) RETURNING * INTO result_key;
 ELSE
  SELECT * INTO result_key FROM public.api_keys WHERE id=p_key_id AND facility_id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KEY_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  UPDATE public.api_keys SET is_active=false WHERE id=p_key_id AND facility_id=p_facility_id RETURNING * INTO result_key;
 END IF;
 RETURN jsonb_build_object('id',result_key.id,'facility_id',result_key.facility_id,'name',result_key.name,
  'key_prefix',result_key.key_prefix,'scopes',result_key.scopes,'is_active',result_key.is_active,
  'last_used_at',result_key.last_used_at,'expires_at',result_key.expires_at,'created_at',result_key.created_at);
END $$;
REVOKE ALL ON FUNCTION public.manage_facility_api_key_atomic(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_facility_api_key_atomic(uuid,uuid,uuid,text,jsonb) TO service_role;
