CREATE FUNCTION public.get_admin_coupon_usage(p_actor_id uuid,p_facility_id uuid)
RETURNS TABLE(coupon_id uuid,usage_count bigint) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.facility_members m WHERE m.user_id=p_actor_id AND m.facility_id=p_facility_id
  AND m.role IN ('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COUPON_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT c.id,count(r.id) FROM public.coupons c
 LEFT JOIN public.coupon_redemptions r ON r.coupon_id=c.id
 WHERE c.facility_id=p_facility_id GROUP BY c.id;
END $$;
REVOKE ALL ON FUNCTION public.get_admin_coupon_usage(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_coupon_usage(uuid,uuid) TO service_role;
