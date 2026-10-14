-- Like staff mutation receipts, preserve only immutable operation identity,
-- scope, a digest and minimal result IDs. No form text/contact data is stored.
CREATE TABLE public.coupon_management_operations (
 operation_id uuid PRIMARY KEY,actor_id uuid NOT NULL,facility_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('create','update','retire')),
 target_coupon_id uuid,result_coupon_id uuid NOT NULL,input_digest bytea NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('saved','deleted','deactivated')),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.coupon_management_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coupon_management_operations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.coupon_management_operations TO service_role;

CREATE FUNCTION public.manage_admin_coupon_with_receipt_atomic(
 p_actor_id uuid,p_facility_id uuid,p_coupon_id uuid,p_operation_id uuid,p_kind text,
 p_fields jsonb DEFAULT '{}'::jsonb,p_target_menu_ids uuid[] DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE prior public.coupon_management_operations; digest bytea; saved public.coupons;
 result_id uuid; result_outcome text; retired record;
BEGIN
 IF p_actor_id IS NULL OR p_facility_id IS NULL OR p_operation_id IS NULL
  OR p_kind IS NULL OR p_kind NOT IN ('create','update','retire')
  OR (p_kind='create' AND p_coupon_id IS NOT NULL) OR (p_kind<>'create' AND p_coupon_id IS NULL) THEN
  RAISE EXCEPTION 'COUPON_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM public.lock_booking_account(p_actor_id);
 PERFORM 1 FROM public.facility_profiles f WHERE f.id=p_facility_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.facility_members m WHERE m.user_id=p_actor_id AND m.facility_id=p_facility_id
  AND m.role IN ('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-coupon-operation:'||p_operation_id::text,0));
 digest:=pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('kind',p_kind,'target',p_coupon_id,'fields',p_fields,'menus',p_target_menu_ids)::text,'UTF8'));
 SELECT * INTO prior FROM public.coupon_management_operations o WHERE o.operation_id=p_operation_id;
 IF FOUND THEN
  IF prior.actor_id<>p_actor_id OR prior.facility_id<>p_facility_id OR prior.kind<>p_kind
   OR prior.target_coupon_id IS DISTINCT FROM p_coupon_id OR prior.input_digest IS DISTINCT FROM digest THEN
   RAISE EXCEPTION 'COUPON_OPERATION_CONFLICT' USING ERRCODE='23505'; END IF;
  IF prior.outcome='saved' THEN
   SELECT * INTO saved FROM public.coupons c WHERE c.id=prior.result_coupon_id AND c.facility_id=p_facility_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_RESULT_RETIRED' USING ERRCODE='P0002'; END IF;
   RETURN jsonb_build_object('was_replay',true,'outcome','saved','coupon',to_jsonb(saved));
  END IF;
  RETURN jsonb_build_object('was_replay',true,'outcome',prior.outcome,'coupon_id',prior.result_coupon_id,'facility_id',p_facility_id);
 END IF;
 IF p_kind='retire' THEN
  SELECT * INTO retired FROM public.retire_admin_coupon_atomic(p_actor_id,p_facility_id,p_coupon_id);
  IF NOT FOUND THEN RETURN NULL; END IF;
  result_id:=retired.coupon_id;result_outcome:=retired.outcome;
 ELSE
  SELECT * INTO saved FROM public.save_admin_coupon_atomic(p_actor_id,p_facility_id,p_coupon_id,p_fields,p_target_menu_ids);
  IF NOT FOUND THEN RETURN NULL; END IF;
  result_id:=saved.id;result_outcome:='saved';
 END IF;
 INSERT INTO public.coupon_management_operations(operation_id,actor_id,facility_id,kind,target_coupon_id,result_coupon_id,input_digest,outcome)
 VALUES(p_operation_id,p_actor_id,p_facility_id,p_kind,p_coupon_id,result_id,digest,result_outcome);
 IF result_outcome='saved' THEN RETURN jsonb_build_object('was_replay',false,'outcome','saved','coupon',to_jsonb(saved)); END IF;
 RETURN jsonb_build_object('was_replay',false,'outcome',result_outcome,'coupon_id',result_id,'facility_id',p_facility_id);
END $$;
REVOKE ALL ON FUNCTION public.manage_admin_coupon_with_receipt_atomic(uuid,uuid,uuid,uuid,text,jsonb,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.manage_admin_coupon_with_receipt_atomic(uuid,uuid,uuid,uuid,text,jsonb,uuid[]) TO service_role;

CREATE FUNCTION public.get_admin_coupon_operation(p_actor_id uuid,p_facility_id uuid,p_operation_id uuid,p_kind text,p_coupon_id uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE prior public.coupon_management_operations;
BEGIN
 IF p_actor_id IS NULL OR p_facility_id IS NULL OR p_operation_id IS NULL
  OR p_kind IS NULL OR p_kind NOT IN ('create','update','retire')
  OR (p_kind='create' AND p_coupon_id IS NOT NULL) OR (p_kind<>'create' AND p_coupon_id IS NULL) THEN
  RAISE EXCEPTION 'COUPON_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM public.lock_booking_account(p_actor_id);
 PERFORM 1 FROM public.facility_members m WHERE m.user_id=p_actor_id AND m.facility_id=p_facility_id AND m.role IN ('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('carelink-coupon-operation:'||p_operation_id::text,0));
 SELECT * INTO prior FROM public.coupon_management_operations o WHERE o.operation_id=p_operation_id;
 IF NOT FOUND THEN RETURN 'absent'; END IF;
 IF prior.actor_id<>p_actor_id OR prior.facility_id<>p_facility_id OR prior.kind<>p_kind
  OR prior.target_coupon_id IS DISTINCT FROM p_coupon_id THEN RAISE EXCEPTION 'COUPON_OPERATION_CONFLICT' USING ERRCODE='23505'; END IF;
 IF prior.outcome<>'saved' OR NOT EXISTS(SELECT 1 FROM public.coupons c WHERE c.id=prior.result_coupon_id AND c.facility_id=p_facility_id) THEN RETURN 'retired'; END IF;
 RETURN 'saved';
END $$;
REVOKE ALL ON FUNCTION public.get_admin_coupon_operation(uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_coupon_operation(uuid,uuid,uuid,text,uuid) TO service_role;
