-- GBP connect binds the save to the facility identity that was verified (2026-10-23).
--
-- /api/admin/gbp/place reads the facility's name/phone/address, looks the place up at Google
-- and accepts it only when they match (src/lib/gbp-ownership.ts). The save then called
-- save_admin_facility_integration_atomic('gbp:connect') with p_expected '{}', so if the owner
-- changed the facility details to match another business, started the request, and restored
-- the real details before the lookup returned, the stale check still attached the other
-- business's place (review finding on PR #790).
--
-- The connect now accepts p_expected = {"identity": {name, phone, postal_code, prefecture,
-- city, address}} and compares it with the row it already locks FOR NO KEY UPDATE; any
-- difference raises INTEGRATION_CHANGED (40001 → 409 「設定が変更されました」). p_expected '{}'
-- stays valid so the currently deployed application keeps working; the new application
-- always sends the identity when it attaches a place (clearing a place sends '{}').
-- Copy of the 20261018023710 definition (the latest; no later migration or DO block
-- replaces it) with only the gbp:connect expected check changed. Safe before or after the
-- application deploy. No data change.
DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

CREATE OR REPLACE FUNCTION public.save_admin_facility_integration_atomic(p_actor_id uuid,p_facility_id uuid,p_kind text,p_expected jsonb,p_values jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE f public.facility_profiles%ROWTYPE; d public.white_label_domains%ROWTYPE; v public.white_label_domains%ROWTYPE; new_place text;
BEGIN
 IF p_actor_id IS NULL OR p_facility_id IS NULL THEN RAISE EXCEPTION 'INTEGRATION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('gbp:connect','gbp:refresh','domain:configure','domain:verify') OR p_values IS NULL OR jsonb_typeof(p_values)<>'object' OR p_expected IS NULL OR jsonb_typeof(p_expected)<>'object'
 THEN RAISE EXCEPTION 'INVALID_INTEGRATION' USING ERRCODE='22023'; END IF;
 PERFORM public.lock_booking_account(p_actor_id);
 PERFORM 1 FROM public.facility_members WHERE user_id=p_actor_id AND facility_id=p_facility_id AND role IN ('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INTEGRATION_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.facility_profiles WHERE id=p_facility_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INTEGRATION_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF p_kind='gbp:connect' THEN
  -- 2026-10-23: a connect may carry the facility identity the app verified the place against.
  -- The row is locked above, so a change of name/phone/address after that check is refused
  -- instead of attaching a place that was matched against stale details.
  IF p_expected ? 'identity' AND (p_expected - 'identity')='{}'::jsonb THEN
   IF p_expected->'identity' IS DISTINCT FROM jsonb_build_object('name',f.name,'phone',f.phone,'postal_code',f.postal_code,
     'prefecture',f.prefecture,'city',f.city,'address',f.address)
   THEN RAISE EXCEPTION 'INTEGRATION_CHANGED' USING ERRCODE='40001'; END IF;
  ELSIF p_expected<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_INTEGRATION' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_values) k WHERE k NOT IN ('place_id','cid'))
   OR NOT (p_values ?& ARRAY['place_id','cid'])
   OR (p_values->'place_id'<>'null'::jsonb AND (jsonb_typeof(p_values->'place_id')<>'string' OR (char_length(p_values->>'place_id') NOT BETWEEN 1 AND 300 OR (p_values->>'place_id') !~ '^[A-Za-z0-9_:-]+$')))
   OR (p_values->'cid'<>'null'::jsonb AND (jsonb_typeof(p_values->'cid')<>'string' OR (p_values->>'cid') !~ '^[A-Za-z0-9_:-]{1,64}$'))
  THEN RAISE EXCEPTION 'INVALID_INTEGRATION' USING ERRCODE='22023'; END IF;
  new_place=p_values->>'place_id';
  IF f.gbp_place_id IS DISTINCT FROM new_place THEN
   DELETE FROM public.gbp_audit_cache WHERE facility_id=p_facility_id;
   UPDATE public.facility_profiles SET google_rating=NULL,google_review_count=0 WHERE id=p_facility_id;
  END IF;
  UPDATE public.facility_profiles SET gbp_place_id=new_place,gbp_cid=p_values->>'cid',gbp_connected_at=CASE WHEN new_place IS NULL THEN NULL ELSE now() END WHERE id=p_facility_id;
 ELSIF p_kind='gbp:refresh' THEN
  IF p_expected IS DISTINCT FROM jsonb_build_object('place_id',f.gbp_place_id) OR f.gbp_place_id IS NULL THEN RAISE EXCEPTION 'INTEGRATION_CHANGED' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_values) k WHERE k NOT IN ('rating','review_count','score','details')) OR NOT (p_values ?& ARRAY['rating','review_count','score','details'])
   OR jsonb_typeof(p_values->'details')<>'object'
   OR (p_values->'rating'<>'null'::jsonb AND (jsonb_typeof(p_values->'rating')<>'number' OR (p_values->>'rating')::numeric NOT BETWEEN 0 AND 5))
   OR jsonb_typeof(p_values->'review_count')<>'number' OR (p_values->>'review_count')::numeric NOT BETWEEN 0 AND 2147483647 OR (p_values->>'review_count')::numeric<>trunc((p_values->>'review_count')::numeric)
   OR jsonb_typeof(p_values->'score')<>'number' OR (p_values->>'score')::numeric NOT BETWEEN 0 AND 2147483647 OR (p_values->>'score')::numeric<>trunc((p_values->>'score')::numeric)
  THEN RAISE EXCEPTION 'INVALID_INTEGRATION' USING ERRCODE='22023'; END IF;
  UPDATE public.facility_profiles SET google_rating=(p_values->>'rating')::numeric,google_review_count=(p_values->>'review_count')::integer WHERE id=p_facility_id;
  INSERT INTO public.gbp_audit_cache(facility_id,score,details,fetched_at) VALUES(p_facility_id,(p_values->>'score')::integer,p_values->'details',now()) ON CONFLICT(facility_id) DO UPDATE SET score=EXCLUDED.score,details=EXCLUDED.details,fetched_at=EXCLUDED.fetched_at;
 ELSE
  SELECT * INTO d FROM public.white_label_domains WHERE facility_id=p_facility_id FOR UPDATE;
  IF p_kind='domain:verify' THEN
   IF d.id IS NULL THEN RAISE EXCEPTION 'INTEGRATION_NOT_FOUND' USING ERRCODE='P0002'; END IF;
   IF p_values<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_INTEGRATION' USING ERRCODE='22023'; END IF;
   IF d.txt_record IS NULL OR p_expected IS DISTINCT FROM jsonb_build_object('domain',d.domain,'txt_record',d.txt_record) THEN RAISE EXCEPTION 'INTEGRATION_CHANGED' USING ERRCODE='40001'; END IF;
   UPDATE public.white_label_domains SET is_verified=true,verified_at=now(),updated_at=now() WHERE id=d.id RETURNING * INTO d;
  ELSE
   IF p_expected<>'{}'::jsonb OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_values) k WHERE k NOT IN ('domain','brand_name','primary_color','logo_url','txt_record')) OR NOT (p_values ?& ARRAY['domain','brand_name','primary_color','logo_url','txt_record']) THEN RAISE EXCEPTION 'INVALID_INTEGRATION' USING ERRCODE='22023'; END IF;
   SELECT * INTO v FROM jsonb_populate_record(NULL::public.white_label_domains,p_values);
   IF v.domain IS NULL OR char_length(v.domain)>253 OR v.domain<>lower(v.domain) OR cardinality(string_to_array(v.domain,'.'))<2 OR EXISTS(SELECT 1 FROM unnest(string_to_array(v.domain,'.')) l WHERE char_length(l) NOT BETWEEN 1 AND 63 OR l !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$') OR v.txt_record IS NULL OR v.txt_record !~ '^carelink-verify=[a-f0-9]{32}$' OR char_length(v.brand_name)>100 OR v.primary_color IS NULL OR v.primary_color !~ '^#[0-9a-fA-F]{6}$' OR (v.logo_url IS NOT NULL AND (char_length(v.logo_url) NOT BETWEEN 9 AND 498 OR v.logo_url !~ '^https://[^[:space:]]+$')) THEN RAISE EXCEPTION 'INVALID_INTEGRATION' USING ERRCODE='22023'; END IF;
   INSERT INTO public.white_label_domains(facility_id,domain,brand_name,primary_color,logo_url,txt_record,is_verified,verified_at,updated_at) VALUES(p_facility_id,v.domain,v.brand_name,v.primary_color,v.logo_url,v.txt_record,false,NULL,now()) ON CONFLICT(facility_id) DO UPDATE SET domain=EXCLUDED.domain,brand_name=EXCLUDED.brand_name,primary_color=EXCLUDED.primary_color,logo_url=EXCLUDED.logo_url,txt_record=EXCLUDED.txt_record,is_verified=false,verified_at=NULL,updated_at=EXCLUDED.updated_at RETURNING * INTO d;
  END IF;
  RETURN to_jsonb(d);
 END IF;
 RETURN jsonb_build_object('id',p_facility_id,'facility_id',p_facility_id);
END $$;
REVOKE ALL ON FUNCTION public.save_admin_facility_integration_atomic(uuid,uuid,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_admin_facility_integration_atomic(uuid,uuid,text,jsonb,jsonb) TO service_role;
