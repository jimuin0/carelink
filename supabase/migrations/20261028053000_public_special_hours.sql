-- Publicly visible schedule facts only, and only for published facilities.
CREATE FUNCTION public.published_special_hours(p_facility_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('closed_dates',s.closed_dates,'close_on_public_holidays',s.close_on_public_holidays,
   'reception_cutoff_minutes',s.reception_cutoff_minutes)
 FROM public.facility_special_hours s JOIN public.facility_profiles f ON f.id=s.facility_id
 WHERE f.id=p_facility_id AND f.status='published';
$$;
REVOKE ALL ON FUNCTION public.published_special_hours(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.published_special_hours(uuid) TO anon,authenticated,service_role;

CREATE OR REPLACE VIEW public.facility_card_view WITH (security_invoker=true,security_barrier=true) AS
 SELECT fp.id,fp.slug,fp.name,fp.business_type,fp.catch_copy,fp.description,fp.prefecture,fp.city,fp.access_info,
 fp.rating_avg,fp.rating_count,fp.main_photo_url,fp.business_hours,fp.seat_count,fp.status,fp.latitude,fp.longitude,
 fp.features,fp.created_at,menu_agg.min_price,menu_agg.max_price,coalesce(menu_agg.menu_count,0) AS menu_count,
 coalesce(coupon_agg.coupon_count,0) AS coupon_count,coalesce(photo_agg.photo_count,0) AS photo_count,
 fp.google_rating,fp.google_review_count,fp.nearest_station,
 coalesce(booking_menu_agg.booking_menu_count,0) AS booking_menu_count,
 coalesce(staff_agg.active_staff_count,0) AS active_staff_count,
 (fp.address IS NOT NULL AND btrim(fp.address)<>'') AS has_address,
 public.published_special_hours(fp.id) AS special_hours
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
 -- Same counting as checkBookingReadiness: active staff who have working time.
 LEFT JOIN LATERAL (
  SELECT count(*)::integer AS active_staff_count FROM public.staff_profiles s
  WHERE s.facility_id=fp.id AND s.is_active AND public.staff_has_working_time(s.id)
 ) staff_agg ON true
 WHERE fp.status='published';
