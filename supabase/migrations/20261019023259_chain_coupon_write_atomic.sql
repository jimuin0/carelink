CREATE OR REPLACE FUNCTION public.save_admin_coupon_atomic(
 p_actor_id uuid,p_facility_id uuid,p_coupon_id uuid,p_fields jsonb,p_target_menu_ids uuid[] DEFAULT NULL
) RETURNS SETOF public.coupons LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v public.coupons; v_old public.coupons; v_menu uuid; v_count integer;
BEGIN
 IF p_actor_id IS NULL OR p_facility_id IS NULL OR jsonb_typeof(p_fields) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'COUPON_INPUT_INVALID' USING ERRCODE='22023';
 END IF;
 PERFORM 1 FROM public.facility_members m WHERE m.user_id=p_actor_id AND m.facility_id=p_facility_id
  AND m.role IN ('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_fields) k WHERE k NOT IN
  ('name','description','coupon_type','discount_type','discount_value','special_price','valid_from','valid_until','is_active')) THEN
  RAISE EXCEPTION 'COUPON_INPUT_INVALID' USING ERRCODE='22023';
 END IF;
 IF p_coupon_id IS NOT NULL THEN
  SELECT * INTO v_old FROM public.coupons WHERE id=p_coupon_id AND facility_id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
 ELSE
  v_old.facility_id:=p_facility_id; v_old.coupon_type:='all'; v_old.is_active:=true;
 END IF;
 BEGIN v:=jsonb_populate_record(v_old,p_fields);
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'COUPON_DATE_INVALID' USING ERRCODE='22023'; END;
 IF (p_coupon_id IS NULL OR p_fields ?| ARRAY['valid_from','valid_until']) AND v.valid_from>v.valid_until THEN RAISE EXCEPTION 'COUPON_DATE_RANGE_INVALID' USING ERRCODE='22023'; END IF;
 IF p_fields ? 'name' OR p_coupon_id IS NULL THEN
  IF v.name IS NULL OR length(btrim(v.name)) NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION 'COUPON_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_fields ?| ARRAY['discount_type','discount_value','special_price'] OR p_coupon_id IS NULL THEN
  IF v.discount_type='fixed' AND v.discount_value BETWEEN 1 AND 100000 THEN v.special_price:=NULL;
  ELSIF v.discount_type='percentage' AND v.discount_value BETWEEN 1 AND 100 THEN v.special_price:=NULL;
  ELSIF v.discount_type='special_price' AND v.special_price BETWEEN 1 AND 9999999 THEN v.discount_value:=NULL;
  ELSE RAISE EXCEPTION 'COUPON_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_target_menu_ids IS NOT NULL THEN
  IF cardinality(p_target_menu_ids)>100 OR array_position(p_target_menu_ids,NULL) IS NOT NULL
   OR cardinality(p_target_menu_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_target_menu_ids) x) THEN
   RAISE EXCEPTION 'COUPON_MENU_SCOPE_INVALID' USING ERRCODE='22023'; END IF;
  v_count:=0;
  FOR v_menu IN SELECT id FROM public.facility_menus WHERE facility_id=p_facility_id
   AND id=ANY(p_target_menu_ids) ORDER BY id FOR SHARE LOOP v_count:=v_count+1; END LOOP;
  IF v_count<>cardinality(p_target_menu_ids) THEN
   RAISE EXCEPTION 'COUPON_MENU_SCOPE_INVALID' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_coupon_id IS NULL THEN
  INSERT INTO public.coupons(facility_id,name,description,coupon_type,discount_type,discount_value,special_price,valid_from,valid_until,is_active)
  VALUES(p_facility_id,v.name,v.description,v.coupon_type,v.discount_type,v.discount_value,v.special_price,v.valid_from,v.valid_until,v.is_active)
  RETURNING * INTO v;
 ELSE
  UPDATE public.coupons SET name=v.name,description=v.description,coupon_type=v.coupon_type,
   discount_type=v.discount_type,discount_value=v.discount_value,special_price=v.special_price,
   valid_from=v.valid_from,valid_until=v.valid_until,is_active=v.is_active
   WHERE id=p_coupon_id AND facility_id=p_facility_id RETURNING * INTO v;
 END IF;
 IF p_target_menu_ids IS NOT NULL THEN
  DELETE FROM public.coupon_menus WHERE coupon_id=v.id;
  INSERT INTO public.coupon_menus(coupon_id,menu_id) SELECT v.id,x FROM unnest(p_target_menu_ids) x;
 END IF;
 RETURN NEXT v;
END $$;

CREATE FUNCTION public.create_chain_coupons_atomic(p_actor_id uuid,p_facility_ids uuid[],p_values jsonb)
RETURNS TABLE(id uuid,facility_id uuid) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE target uuid; saved public.coupons;
BEGIN
 IF p_actor_id IS NULL OR p_facility_ids IS NULL OR cardinality(p_facility_ids) NOT BETWEEN 1 AND 50
  OR array_position(p_facility_ids,NULL) IS NOT NULL OR cardinality(p_facility_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_facility_ids) x)
  OR jsonb_typeof(p_values) IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'INVALID_CHAIN_COUPON' USING ERRCODE='22023'; END IF;
 BEGIN PERFORM public.lock_booking_account(p_actor_id);
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='BOOKING_ACCOUNT_UNAVAILABLE' THEN RAISE EXCEPTION 'CHAIN_COUPON_FORBIDDEN' USING ERRCODE='42501'; ELSE RAISE; END IF;
 END;
 FOR target IN SELECT x FROM unnest(p_facility_ids) x ORDER BY x LOOP
  PERFORM 1 FROM public.facility_profiles WHERE public.facility_profiles.id=target FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CHAIN_COUPON_FORBIDDEN' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.facility_members WHERE user_id=p_actor_id AND public.facility_members.facility_id=target AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CHAIN_COUPON_FORBIDDEN' USING ERRCODE='42501'; END IF;
 END LOOP;
 FOR target IN SELECT x FROM unnest(p_facility_ids) x ORDER BY x LOOP
  BEGIN
   SELECT * INTO saved FROM public.save_admin_coupon_atomic(p_actor_id,target,NULL,p_values,ARRAY[]::uuid[]);
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
   RAISE EXCEPTION 'INVALID_CHAIN_COUPON_DATE' USING ERRCODE='22023';
  END;
  IF saved.id IS NULL THEN RAISE EXCEPTION 'CHAIN_COUPON_UNCONFIRMED' USING ERRCODE='22023'; END IF;
  id=saved.id;facility_id=saved.facility_id;RETURN NEXT;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.create_chain_coupons_atomic(uuid,uuid[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_chain_coupons_atomic(uuid,uuid[],jsonb) TO service_role;
