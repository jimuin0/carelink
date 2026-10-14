-- Lock the referenced coupon before testing usage, so concurrent FK inserts
-- cannot commit between a count and a cascading deletion.
CREATE FUNCTION public.retire_admin_coupon_atomic(p_actor_id uuid,p_facility_id uuid,p_coupon_id uuid)
RETURNS TABLE(outcome text,coupon_id uuid,facility_id uuid) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.facility_members m WHERE m.user_id=p_actor_id AND m.facility_id=p_facility_id
  AND m.role IN ('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.coupons c WHERE c.id=p_coupon_id AND c.facility_id=p_facility_id FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.coupon_redemptions r WHERE r.coupon_id=p_coupon_id)
  OR EXISTS(SELECT 1 FROM public.bookings b WHERE b.coupon_id=p_coupon_id) THEN
  UPDATE public.coupons c SET is_active=false WHERE c.id=p_coupon_id AND c.facility_id=p_facility_id;
  RETURN QUERY SELECT 'deactivated'::text,p_coupon_id,p_facility_id;
 ELSE
  DELETE FROM public.coupons c WHERE c.id=p_coupon_id AND c.facility_id=p_facility_id;
  RETURN QUERY SELECT 'deleted'::text,p_coupon_id,p_facility_id;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.retire_admin_coupon_atomic(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retire_admin_coupon_atomic(uuid,uuid,uuid) TO service_role;
