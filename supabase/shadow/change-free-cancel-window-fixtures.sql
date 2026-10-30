-- Disposable PG17 shadow only. Synthetic rows, rolled back; never call a provider.
-- 20261023164100: once a reservation is past the shop's free-cancellation deadline,
-- the customer can no longer change its date/time online (神原さん 2026-10-23, option A;
-- BOOKING_CHANGE_WINDOW_CLOSED). The shop's own change (p_enforce_schedule = false),
-- 期限なし (always_fee), ネットでのキャンセル不可 (no_online), a 0% rate and shops
-- without a policy are unaffected. Same rule as src/lib/cancel-fee.ts isPastFreeCancelWindow.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout = '15s';
DO $$ BEGIN IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'DISPOSABLE_DB_REQUIRED'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_window(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'change free-cancel window fixture failed: %', label; END IF; END $$;
CREATE FUNCTION pg_temp.jst_today() RETURNS date LANGUAGE sql AS $$ SELECT (clock_timestamp() AT TIME ZONE 'Asia/Tokyo')::date $$;

INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
 ('cd100000-0000-4000-8000-000000000001'::uuid, 'window-customer@example.invalid', now());
INSERT INTO public.facility_profiles(id, name, slug, business_type, prefecture, city, address, status)
 VALUES ('cd110000-0000-4000-8000-000000000001'::uuid, 'Window clinic', 'change-window-synthetic', 'その他', '検証県', '検証市', '検証住所', 'draft');
INSERT INTO public.facility_menus(id, facility_id, category, name, price, duration_minutes, is_published) VALUES
 ('cd120000-0000-4000-8000-000000000001'::uuid, 'cd110000-0000-4000-8000-000000000001'::uuid, 'synthetic', 'Open menu', 10000, 60, true);
INSERT INTO public.staff_profiles(id, facility_id, name, slug, is_active, sort_order) VALUES
 ('cd130000-0000-4000-8000-000000000001'::uuid, 'cd110000-0000-4000-8000-000000000001'::uuid, 'Staff A', 'change-window-a', true, 1);
INSERT INTO public.staff_schedules(staff_id, day_of_week, start_time, end_time)
 SELECT 'cd130000-0000-4000-8000-000000000001'::uuid, d, '08:00', '20:00' FROM generate_series(0, 6) d;
INSERT INTO public.facility_photos(facility_id, photo_url, photo_type)
 VALUES ('cd110000-0000-4000-8000-000000000001'::uuid, 'https://example.invalid/change-window.jpg', 'other');
\ir listing-verification-setup.sql
SELECT pg_temp.approve_synthetic_listing('cd110000-0000-4000-8000-000000000001');
UPDATE public.facility_profiles SET status = 'published',
 business_hours = '{"mon":{"open":"08:00","close":"20:00"},"tue":{"open":"08:00","close":"20:00"},"wed":{"open":"08:00","close":"20:00"},"thu":{"open":"08:00","close":"20:00"},"fri":{"open":"08:00","close":"20:00"},"sat":{"open":"08:00","close":"20:00"},"sun":{"open":"08:00","close":"20:00"}}'
 WHERE id = 'cd110000-0000-4000-8000-000000000001'::uuid;

-- The customer's nominated ¥10,000 reservation, 3 days ahead (JST) at 10:00: between 58 and
-- 82 hours from now whatever the time of day, so it is inside a 168-hour window and
-- outside a 24-hour one.
INSERT INTO public.bookings(id, facility_id, staff_id, user_id, menu_id, booking_date, start_time, end_time, customer_name, email, status, total_price)
 VALUES ('cd140000-0000-4000-8000-000000000001'::uuid, 'cd110000-0000-4000-8000-000000000001'::uuid, 'cd130000-0000-4000-8000-000000000001'::uuid,
  'cd100000-0000-4000-8000-000000000001'::uuid, 'cd120000-0000-4000-8000-000000000001'::uuid, pg_temp.jst_today() + 3, '10:00', '11:00',
  'Customer', 'window-customer@example.invalid', 'confirmed', 10000);

CREATE FUNCTION pg_temp.reset_booking() RETURNS void LANGUAGE sql AS $$
  UPDATE public.bookings SET booking_date = pg_temp.jst_today() + 3, start_time = '10:00', end_time = '11:00'
  WHERE id = 'cd140000-0000-4000-8000-000000000001'::uuid;
$$;
CREATE FUNCTION pg_temp.still_original() RETURNS boolean LANGUAGE sql AS $$
  SELECT booking_date = pg_temp.jst_today() + 3 AND start_time = '10:00' FROM public.bookings
  WHERE id = 'cd140000-0000-4000-8000-000000000001'::uuid;
$$;
-- Move the reservation 10 days ahead (same time and length). p_enforce = true is the
-- customer's path (/api/booking/[id]/change); false is the shop's manual change.
CREATE FUNCTION pg_temp.change_outcome(p_enforce boolean) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.change_booking_atomic('cd140000-0000-4000-8000-000000000001'::uuid, 'cd100000-0000-4000-8000-000000000001'::uuid,
    pg_temp.jst_today() + 10, '10:00', '11:00', p_enforce);
  RETURN 'accepted';
EXCEPTION WHEN raise_exception THEN RETURN split_part(SQLERRM, ':', 1);
END $$;
CREATE FUNCTION pg_temp.set_policy(p_rule text, p_hours int, p_rate int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.facility_cancel_policies(facility_id, cancel_rule, free_cancel_hours, late_cancel_rate)
  VALUES ('cd110000-0000-4000-8000-000000000001'::uuid, p_rule, p_hours, p_rate)
  ON CONFLICT (facility_id) DO UPDATE SET cancel_rule = EXCLUDED.cancel_rule,
    free_cancel_hours = EXCLUDED.free_cancel_hours, late_cancel_rate = EXCLUDED.late_cancel_rate;
$$;

DO $$ BEGIN
  PERFORM pg_temp.assert_window(public.facility_booking_ready('cd110000-0000-4000-8000-000000000001'::uuid), 'synthetic facility accepts online bookings');

  -- 1. 「N時間前まで無料」 and the reservation inside the window: the customer cannot move it.
  PERFORM pg_temp.set_policy('free_window', 168, 50);
  -- Regression: the change was accepted, and cancelling afterwards was free (the fee used the new time).
  PERFORM pg_temp.assert_window(pg_temp.change_outcome(true) = 'BOOKING_CHANGE_WINDOW_CLOSED',
    'a customer change inside the free-cancellation window is refused');
  PERFORM pg_temp.assert_window(pg_temp.still_original(), 'the refused change leaves the reservation as it was');
  -- The customer gateway the API calls is refused the same way, before any email or channel is queued.
  BEGIN
    PERFORM public.change_customer_booking_with_channels_atomic('cd140000-0000-4000-8000-000000000001'::uuid,
      'cd100000-0000-4000-8000-000000000001'::uuid, pg_temp.jst_today() + 10, '10:00', '11:00', true);
    RAISE EXCEPTION 'customer gateway accepted a change inside the free-cancellation window';
  EXCEPTION WHEN raise_exception THEN
    IF split_part(SQLERRM, ':', 1) <> 'BOOKING_CHANGE_WINDOW_CLOSED' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.assert_window(pg_temp.still_original()
    AND NOT EXISTS (SELECT 1 FROM public.webhook_retry_queue WHERE facility_id = 'cd110000-0000-4000-8000-000000000001'::uuid),
    'the refused gateway call queues nothing');

  -- 2. The shop's own change is unaffected.
  PERFORM pg_temp.assert_window(pg_temp.change_outcome(false) = 'accepted', 'the shop can still move the reservation inside the window');
  PERFORM pg_temp.reset_booking();

  -- 3. Outside the window the customer can still move it.
  PERFORM pg_temp.set_policy('free_window', 24, 50);
  PERFORM pg_temp.assert_window(pg_temp.change_outcome(true) = 'accepted', 'a customer change before the free-cancellation deadline is accepted');
  PERFORM pg_temp.assert_window((SELECT booking_date = pg_temp.jst_today() + 10 FROM public.bookings
    WHERE id = 'cd140000-0000-4000-8000-000000000001'::uuid), 'the accepted change is stored');
  PERFORM pg_temp.reset_booking();

  -- 4. A row saved before cancel_rule existed (NULL) reads from free_cancel_hours.
  PERFORM pg_temp.set_policy(NULL, 168, 50);
  PERFORM pg_temp.assert_window(pg_temp.change_outcome(true) = 'BOOKING_CHANGE_WINDOW_CLOSED', 'a legacy 168-hour window is enforced');
  PERFORM pg_temp.set_policy(NULL, NULL, 50);
  PERFORM pg_temp.assert_window(pg_temp.change_outcome(true) = 'accepted', 'NULL hours read as 24 (the reservation is beyond 24 hours)');
  PERFORM pg_temp.reset_booking();
  PERFORM pg_temp.set_policy(NULL, 0, 50);
  PERFORM pg_temp.assert_window(pg_temp.change_outcome(true) = 'accepted', 'a legacy 0-hour row reads as 期限なし (a fee applies anyway)');
  PERFORM pg_temp.reset_booking();
  PERFORM pg_temp.set_policy('free_window', 0, 50);
  PERFORM pg_temp.assert_window(pg_temp.change_outcome(true) = 'accepted', 'free_window with 0 hours reads as 期限なし');
  PERFORM pg_temp.reset_booking();

  -- 5. Rules where moving the reservation does not avoid a fee stay as before.
  PERFORM pg_temp.set_policy('always_fee', 168, 50);
  PERFORM pg_temp.assert_window(pg_temp.change_outcome(true) = 'accepted', '期限なし (always_fee): a change is accepted');
  PERFORM pg_temp.reset_booking();
  PERFORM pg_temp.set_policy('no_online', 168, 50);
  PERFORM pg_temp.assert_window(pg_temp.change_outcome(true) = 'accepted', 'ネットでのキャンセル不可 (no_online): a change is accepted as before');
  PERFORM pg_temp.reset_booking();
  PERFORM pg_temp.set_policy('free_window', 168, 0);
  PERFORM pg_temp.assert_window(pg_temp.change_outcome(true) = 'accepted', 'a 0% rate has no fee to avoid');
  PERFORM pg_temp.reset_booking();
  PERFORM pg_temp.set_policy('free_window', 168, NULL);
  PERFORM pg_temp.assert_window(pg_temp.change_outcome(true) = 'accepted', 'a NULL rate reads as 0%');
  PERFORM pg_temp.reset_booking();
  DELETE FROM public.facility_cancel_policies WHERE facility_id = 'cd110000-0000-4000-8000-000000000001'::uuid;
  PERFORM pg_temp.assert_window(pg_temp.change_outcome(true) = 'accepted', 'a shop without a policy is unaffected');
  PERFORM pg_temp.reset_booking();
END $$;

-- 6. Signature, SECURITY DEFINER, search_path and grants are kept.
DO $$ BEGIN
  PERFORM pg_temp.assert_window((SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc
    WHERE oid = 'public.change_booking_atomic(uuid,uuid,date,time,time,boolean)'::regprocedure),
    'change_booking_atomic stays SECURITY DEFINER with search_path=public');
  PERFORM pg_temp.assert_window(NOT has_function_privilege('anon', 'public.change_booking_atomic(uuid,uuid,date,time,time,boolean)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.change_booking_atomic(uuid,uuid,date,time,time,boolean)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.change_booking_atomic(uuid,uuid,date,time,time,boolean)', 'EXECUTE'),
    'the change RPC keeps its grants');
END $$;
ROLLBACK;
