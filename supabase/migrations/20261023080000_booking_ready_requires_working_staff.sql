-- Online booking is offered only when at least one staff member actually works.
--
-- 【なぜ】facility_booking_ready and the search card's active_staff_count only asked
-- whether an ACTIVE staff member existed. get_available_slots / booking_staff_works_slot
-- open slots only inside a staff member's working time (a weekly staff_schedules row, or a
-- schedule_overrides row with times that is not a holiday). A published shop whose active
-- staff had no working time therefore showed 「予約OK」 on its search card, while its
-- calendar read 満枠 on every open day and no slot could ever be booked.
-- From 20261023080100 a newly added staff member starts with no working time until the
-- owner saves one (神原さん決定 2026-10-22「店舗によって営業時間もシフトも違う」), so this
-- state becomes the normal first step of a new shop, not a rare one.
--
-- 【規則】A staff member can take bookings when active AND they have a weekly working day
-- or an upcoming working special day (today or later in JST, not a holiday, with a start
-- and an end time). public.staff_has_working_time is the single SQL source; the app mirrors
-- it in readWorkingStaff / workingStaffQuery (src/lib/facility-publish-gate.ts), which the
-- booking page, the slot APIs, the owner's setup checklist and the day-3 email read.
--
-- 【互換】facility_booking_ready keeps its signature, volatility, SECURITY INVOKER,
-- search_path and grants; facility_card_view keeps every column name, type and position
-- (only the active_staff_count expression is narrowed). Safe to apply before or after the
-- app deploy: the deployed app reads the same function and column and simply stops
-- advertising shops nobody can be booked with. Apply before 20261023080100.
--
-- No data is changed.
DO $guard$ BEGIN IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'not the CareLink database'; END IF; END $guard$;

CREATE OR REPLACE FUNCTION public.staff_has_working_time(p_staff_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.staff_schedules ss WHERE ss.staff_id = p_staff_id)
    OR EXISTS (
      SELECT 1 FROM public.schedule_overrides so
      WHERE so.staff_id = p_staff_id
        AND so.date >= (pg_catalog.now() AT TIME ZONE 'Asia/Tokyo')::date
        AND so.is_holiday IS NOT TRUE
        AND so.start_time IS NOT NULL
        AND so.end_time IS NOT NULL
    );
$$;
-- Same audience as facility_booking_ready: the card view is security_invoker, so anon
-- evaluates it when reading search cards.
REVOKE ALL ON FUNCTION public.staff_has_working_time(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_has_working_time(uuid) TO anon, authenticated, service_role;

-- 20261002012045 definition (the latest; no later migration replaces or patches it) with
-- the staff clause narrowed to staff who work.
CREATE OR REPLACE FUNCTION public.facility_booking_ready(p_facility_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.facility_profiles f WHERE f.id = p_facility_id
      AND f.status = 'published' AND f.name ~ '[^[:space:]　]'
      AND f.prefecture ~ '[^[:space:]　]' AND f.city ~ '[^[:space:]　]' AND f.address ~ '[^[:space:]　]'
      AND public.confirmed_booking_hours(f.business_hours)
      AND EXISTS (SELECT 1 FROM public.facility_menus m WHERE m.facility_id = f.id AND m.is_published IS DISTINCT FROM false)
      AND EXISTS (SELECT 1 FROM public.facility_photos p WHERE p.facility_id = f.id)
      AND EXISTS (SELECT 1 FROM public.staff_profiles s WHERE s.facility_id = f.id AND s.is_active
        AND public.staff_has_working_time(s.id))
  );
$$;
REVOKE ALL ON FUNCTION public.facility_booking_ready(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.facility_booking_ready(uuid) TO anon, authenticated, service_role;

-- 20261021060000 definition (the latest) with active_staff_count counting only staff who
-- work. Column list and order are unchanged (CREATE OR REPLACE VIEW requires it).
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
 -- Same counting as checkBookingReadiness: active staff who have working time.
 LEFT JOIN LATERAL (
  SELECT count(*)::integer AS active_staff_count FROM public.staff_profiles s
  WHERE s.facility_id=fp.id AND s.is_active AND public.staff_has_working_time(s.id)
 ) staff_agg ON true
 WHERE fp.status='published';

REVOKE ALL ON public.facility_card_view FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.facility_card_view TO anon,authenticated,service_role;

COMMENT ON COLUMN public.facility_card_view.active_staff_count IS
  'Active staff who can take bookings: a weekly working day or an upcoming working special day (public.staff_has_working_time). Feeds the search card 「予約OK」 rule (isCardBookingReady).';
