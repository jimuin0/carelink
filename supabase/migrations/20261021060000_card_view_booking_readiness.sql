-- Expose the online-booking readiness inputs on public search cards so the
-- 「予約OK」 badge uses the same rule as the booking page
-- (bookingReadinessMissing in src/lib/facility-publish-gate.ts). Before this,
-- every published card showed 「予約OK」, including facilities whose page then
-- refused online booking. New columns are appended (CREATE OR REPLACE VIEW only
-- allows that), so the deployed application keeps working before its update.
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

CREATE OR REPLACE VIEW public.facility_card_view WITH (security_invoker=true,security_barrier=true) AS
 SELECT fp.id,fp.slug,fp.name,fp.business_type,fp.catch_copy,fp.description,fp.prefecture,fp.city,fp.access_info,
 fp.rating_avg,fp.rating_count,fp.main_photo_url,fp.business_hours,fp.seat_count,fp.status,fp.latitude,fp.longitude,
 fp.features,fp.created_at,menu_agg.min_price,menu_agg.max_price,coalesce(menu_agg.menu_count,0) AS menu_count,
 coalesce(coupon_agg.coupon_count,0) AS coupon_count,coalesce(photo_agg.photo_count,0) AS photo_count,
 fp.google_rating,fp.google_review_count,fp.nearest_station,
 coalesce(booking_menu_agg.booking_menu_count,0) AS booking_menu_count,
 coalesce(staff_agg.active_staff_count,0) AS active_staff_count,
 (fp.address IS NOT NULL AND btrim(fp.address)<>'') AS has_address
 FROM public.facility_profiles fp
 LEFT JOIN LATERAL (
  SELECT min(m.price) AS min_price,max(m.price) AS max_price,count(*)::integer AS menu_count
  FROM public.facility_menus m WHERE m.facility_id=fp.id AND m.price IS NOT NULL AND coalesce(m.is_published,true)
 ) menu_agg ON true
 LEFT JOIN LATERAL (
  SELECT count(*)::integer AS coupon_count FROM public.coupons c
  WHERE c.facility_id=fp.id AND c.is_active=true
   AND (c.valid_from IS NULL OR c.valid_from<=(now() AT TIME ZONE 'Asia/Tokyo')::date)
   AND (c.valid_until IS NULL OR c.valid_until>=(now() AT TIME ZONE 'Asia/Tokyo')::date)
 ) coupon_agg ON true
 LEFT JOIN LATERAL (
  SELECT count(*)::integer AS photo_count FROM public.facility_photos p WHERE p.facility_id=fp.id
 ) photo_agg ON true
 -- Same counting as checkBookingReadiness: published menus regardless of price.
 LEFT JOIN LATERAL (
  SELECT count(*)::integer AS booking_menu_count FROM public.facility_menus m
  WHERE m.facility_id=fp.id AND coalesce(m.is_published,true)
 ) booking_menu_agg ON true
 LEFT JOIN LATERAL (
  SELECT count(*)::integer AS active_staff_count FROM public.staff_profiles s
  WHERE s.facility_id=fp.id AND s.is_active
 ) staff_agg ON true
 WHERE fp.status='published';

REVOKE ALL ON public.facility_card_view FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.facility_card_view TO anon,authenticated,service_role;
