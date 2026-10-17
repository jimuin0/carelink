-- Profile and menu assignment replacement are one authorized transaction.
CREATE FUNCTION public.save_admin_staff_atomic(
 p_actor_id uuid,p_facility_id uuid,p_staff_id uuid,p_values jsonb,p_menu_ids uuid[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE current_staff public.staff_profiles%ROWTYPE;
 values_staff public.staff_profiles%ROWTYPE; result_staff public.staff_profiles%ROWTYPE; matched integer;
BEGIN
 IF p_actor_id IS NULL OR p_facility_id IS NULL THEN
  RAISE EXCEPTION 'STAFF_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_staff_id IS NULL OR p_values IS NULL OR jsonb_typeof(p_values)<>'object' OR p_values='{}'::jsonb
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_values) k WHERE k NOT IN
   ('name','position','bio','specialties','years_experience','instagram_url','nomination_fee','line_works_channel_id','line_works_notify_all','is_active'))
  OR (p_menu_ids IS NOT NULL AND (cardinality(p_menu_ids)>200 OR array_ndims(p_menu_ids)>1
   OR array_position(p_menu_ids,NULL) IS NOT NULL
   OR cardinality(p_menu_ids)<>(SELECT count(DISTINCT m) FROM unnest(p_menu_ids) m)))
 THEN RAISE EXCEPTION 'INVALID_STAFF_MUTATION' USING ERRCODE='22023'; END IF;
 PERFORM public.lock_booking_account(p_actor_id);
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-staff-schedule:'||p_facility_id::text,0));
 PERFORM 1 FROM public.facility_profiles WHERE id=p_facility_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 PERFORM 1 FROM public.facility_members WHERE user_id=p_actor_id AND facility_id=p_facility_id AND role IN ('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO current_staff FROM public.staff_profiles WHERE id=p_staff_id AND facility_id=p_facility_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'STAFF_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF p_menu_ids IS NOT NULL THEN
  PERFORM m.id FROM public.facility_menus m WHERE m.id=ANY(p_menu_ids) AND m.facility_id=p_facility_id ORDER BY m.id FOR SHARE;
  GET DIAGNOSTICS matched=ROW_COUNT;
  IF matched<>cardinality(p_menu_ids) THEN RAISE EXCEPTION 'INVALID_STAFF_MENU' USING ERRCODE='22023'; END IF;
 END IF;
 SELECT * INTO values_staff FROM jsonb_populate_record(current_staff,p_values);
 IF values_staff.name IS NULL OR char_length(values_staff.name) NOT BETWEEN 1 AND 50 THEN
  RAISE EXCEPTION 'INVALID_STAFF_MUTATION' USING ERRCODE='22023'; END IF;
 UPDATE public.staff_profiles SET name=values_staff.name,position=values_staff.position,bio=values_staff.bio,
  specialties=values_staff.specialties,years_experience=values_staff.years_experience,
  instagram_url=values_staff.instagram_url,nomination_fee=values_staff.nomination_fee,
  line_works_channel_id=values_staff.line_works_channel_id,line_works_notify_all=values_staff.line_works_notify_all,
  is_active=values_staff.is_active,updated_at=clock_timestamp()
  WHERE id=p_staff_id AND facility_id=p_facility_id RETURNING * INTO result_staff;
 IF p_menu_ids IS NOT NULL THEN
  DELETE FROM public.menu_staff WHERE staff_id=p_staff_id;
  INSERT INTO public.menu_staff(menu_id,staff_id) SELECT m,p_staff_id FROM unnest(p_menu_ids) m;
 END IF;
 RETURN to_jsonb(result_staff);
END $$;
REVOKE ALL ON FUNCTION public.save_admin_staff_atomic(uuid,uuid,uuid,jsonb,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_admin_staff_atomic(uuid,uuid,uuid,jsonb,uuid[]) TO service_role;
