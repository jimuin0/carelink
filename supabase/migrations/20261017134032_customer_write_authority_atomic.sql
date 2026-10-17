-- Authorize and lock current membership with customer-master mutations.
CREATE FUNCTION public.manage_admin_customer_atomic(
 p_actor_id uuid,p_facility_id uuid,p_customer_id uuid,p_action text,p_values jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE current_customer public.customers%ROWTYPE;
 values_customer public.customers%ROWTYPE; result_customer public.customers%ROWTYPE;
BEGIN
 IF p_actor_id IS NULL OR p_facility_id IS NULL THEN RAISE EXCEPTION 'CUSTOMER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('create','update','delete')
  OR (p_action='create' AND p_customer_id IS NOT NULL)
  OR (p_action<>'create' AND p_customer_id IS NULL)
  OR p_values IS NULL OR jsonb_typeof(p_values)<>'object'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_values) k WHERE k NOT IN ('name','name_kana','email','phone','birthday','gender','notes'))
  OR (p_action='delete' AND p_values<>'{}'::jsonb)
 THEN RAISE EXCEPTION 'INVALID_CUSTOMER_MUTATION' USING ERRCODE='22023'; END IF;
 PERFORM public.lock_booking_account(p_actor_id);
 PERFORM 1 FROM public.facility_members WHERE user_id=p_actor_id AND facility_id=p_facility_id AND role IN ('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_FORBIDDEN' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.facility_profiles WHERE id=p_facility_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF p_action<>'create' THEN
  SELECT * INTO current_customer FROM public.customers WHERE id=p_customer_id AND facility_id=p_facility_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 END IF;
 IF p_action='delete' THEN
  DELETE FROM public.customers WHERE id=p_customer_id AND facility_id=p_facility_id RETURNING * INTO result_customer;
  RETURN to_jsonb(result_customer);
 END IF;
 SELECT * INTO values_customer FROM jsonb_populate_record(current_customer,p_values);
 IF values_customer.name IS NULL OR char_length(btrim(values_customer.name)) NOT BETWEEN 1 AND 50 THEN
  RAISE EXCEPTION 'INVALID_CUSTOMER_MUTATION' USING ERRCODE='22023'; END IF;
 IF p_action='create' THEN
  INSERT INTO public.customers(facility_id,name,name_kana,email,phone,birthday,gender,notes)
   VALUES(p_facility_id,values_customer.name,values_customer.name_kana,values_customer.email,values_customer.phone,values_customer.birthday,values_customer.gender,values_customer.notes)
   RETURNING * INTO result_customer;
 ELSE
  UPDATE public.customers SET name=values_customer.name,name_kana=values_customer.name_kana,email=values_customer.email,
   phone=values_customer.phone,birthday=values_customer.birthday,gender=values_customer.gender,notes=values_customer.notes
   WHERE id=p_customer_id AND facility_id=p_facility_id RETURNING * INTO result_customer;
 END IF;
 RETURN to_jsonb(result_customer);
END $$;
REVOKE ALL ON FUNCTION public.manage_admin_customer_atomic(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_admin_customer_atomic(uuid,uuid,uuid,text,jsonb) TO service_role;
