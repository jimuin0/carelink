-- Runs against the disposable Postgres 17 database built from every migration in CI.
-- No external systems or production data are touched; the transaction is rolled back.
BEGIN;

CREATE OR REPLACE FUNCTION public._carelink_test_block_visit_award_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND OLD.reason = '来店ポイント'
     AND current_setting('carelink.test_block_visit_award_delete', true) = 'on' THEN
    RAISE EXCEPTION 'BOOKING_ATOMIC_TEST_DELETE_BLOCKED';
  END IF;
  IF TG_OP = 'INSERT'
     AND NEW.reason = 'キャンセル返還'
     AND current_setting('carelink.test_block_refund_insert', true) = 'on' THEN
    RAISE EXCEPTION 'BOOKING_ATOMIC_TEST_REFUND_BLOCKED' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER _carelink_test_block_visit_award_delete
  BEFORE INSERT OR DELETE ON public.user_points
  FOR EACH ROW EXECUTE FUNCTION public._carelink_test_block_visit_award_delete();

DO $$
DECLARE
  v_facility UUID := 'eeee0000-0000-4000-8000-000000000001';
  v_staff UUID := 'eeee0000-0000-4000-8000-000000000002';
  v_user UUID := 'eeee0000-0000-4000-8000-000000000003';
  v_poor_user UUID := 'eeee0000-0000-4000-8000-000000000004';
  v_booking UUID;
  v_result JSONB;
  v_count INT;
  v_date DATE := current_date + 180;
  v_key UUID := 'eeee0000-0000-4000-8000-000000000011';
  v_poor_key UUID := 'eeee0000-0000-4000-8000-000000000012';
BEGIN
  IF has_function_privilege('anon', 'public.create_booking_with_points_atomic(uuid,uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,text,text,text,text,integer,uuid,integer,text,boolean,uuid[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.create_booking_with_points_atomic(uuid,uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,text,text,text,text,integer,uuid,integer,text,boolean,uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.create_booking_with_points_atomic(uuid,uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,text,text,text,text,integer,uuid,integer,text,boolean,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'create_booking_with_points_atomic ACL mismatch';
  END IF;

  IF has_function_privilege('anon', 'public.deduct_booking_points_atomic(uuid,integer,text,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.deduct_booking_points_atomic(uuid,integer,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.deduct_booking_points_atomic(uuid,integer,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'deduct_booking_points_atomic ACL mismatch';
  END IF;

  IF has_function_privilege('anon', 'public.cancel_booking_with_points_atomic(uuid,uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.cancel_booking_with_points_atomic(uuid,uuid,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.cancel_booking_with_points_atomic(uuid,uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'cancel_booking_with_points_atomic ACL mismatch';
  END IF;

  IF has_function_privilege('anon', 'public.mark_booking_no_show_atomic(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mark_booking_no_show_atomic(uuid,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.mark_booking_no_show_atomic(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'mark_booking_no_show_atomic ACL mismatch';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_user_points_booking_debit_unique')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_user_points_booking_credit_unique')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_bookings_idempotency_key_unique') THEN
    RAISE EXCEPTION 'booking points/idempotency unique indexes missing';
  END IF;

  INSERT INTO auth.users(id, email) VALUES
    (v_user, 'booking-atomic-user@example.invalid'),
    (v_poor_user, 'booking-atomic-poor@example.invalid');
  INSERT INTO public.facility_profiles(id, name, slug, business_type, prefecture, city, address, status)
    VALUES (v_facility, 'Atomic test facility', 'atomic-test-20260920', 'test', '東京都', 'テスト市', 'テスト住所', 'published');
  INSERT INTO public.staff_profiles(id, facility_id, name, slug)
    VALUES (v_staff, v_facility, 'Atomic test staff', 'atomic-test-staff');
  INSERT INTO public.user_points(user_id, points, reason)
    VALUES (v_user, 100, 'atomic integration seed');

  v_result := public.create_booking_with_points_atomic(
    v_facility, v_staff, v_user, NULL, NULL, v_date, '10:00', '11:00',
    'Synthetic test customer', 'booking-atomic-user@example.invalid', NULL, NULL,
    5000, v_key, 20, 'pending', false, NULL
  );
  v_booking := (v_result->>'booking_id')::UUID;
  IF v_result->>'replayed' <> 'false' OR v_booking IS NULL THEN
    RAISE EXCEPTION 'first booking request did not create a booking: %', v_result;
  END IF;

  v_result := public.create_booking_with_points_atomic(
    v_facility, v_staff, v_user, NULL, NULL, v_date, '10:00', '11:00',
    'Synthetic test customer', 'booking-atomic-user@example.invalid', NULL, NULL,
    5000, v_key, 20, 'pending', false, NULL
  );
  IF v_result->>'replayed' <> 'true' OR (v_result->>'booking_id')::UUID <> v_booking THEN
    RAISE EXCEPTION 'idempotent retry did not return the original booking: %', v_result;
  END IF;
  SELECT COUNT(*) INTO v_count FROM public.user_points WHERE booking_id = v_booking AND points = -20;
  IF v_count <> 1 THEN RAISE EXCEPTION 'idempotent retry duplicated point debit'; END IF;
  BEGIN
    INSERT INTO public.user_points(user_id, points, reason, booking_id)
      VALUES (v_user, -1, 'duplicate debit test', v_booking);
    RAISE EXCEPTION 'EXPECTED_DUPLICATE_DEBIT_REJECTION';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    PERFORM public.create_booking_with_points_atomic(
      v_facility, v_staff, v_poor_user, NULL, NULL, v_date, '10:00', '11:00',
      'Different synthetic user', 'booking-atomic-poor@example.invalid', NULL, NULL,
      5000, v_key, 20, 'pending', false, NULL
    );
    RAISE EXCEPTION 'EXPECTED_IDEMPOTENCY_KEY_REUSE_REJECTION';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'IDEMPOTENCY_KEY_REUSED' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.create_booking_with_points_atomic(
      v_facility, v_staff, v_poor_user, NULL, NULL, v_date + 1, '10:00', '11:00',
      'Synthetic poor customer', 'booking-atomic-poor@example.invalid', NULL, NULL,
      1000, v_poor_key, 1, 'pending', false, NULL
    );
    RAISE EXCEPTION 'EXPECTED_INSUFFICIENT_POINTS';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'INSUFFICIENT_POINTS' THEN RAISE; END IF;
  END;
  SELECT COUNT(*) INTO v_count FROM public.bookings WHERE idempotency_key = v_poor_key;
  IF v_count <> 0 THEN RAISE EXCEPTION 'insufficient points left a booking behind'; END IF;

  UPDATE public.bookings SET status = 'completed' WHERE id = v_booking;
  INSERT INTO public.customer_visits(facility_id, booking_id, customer_email, customer_name, visit_date)
    VALUES (v_facility, v_booking, 'booking-atomic-user@example.invalid', 'Synthetic test customer', v_date);
  INSERT INTO public.user_points(user_id, points, reason, booking_id)
    VALUES (v_user, 10, '来店ポイント', v_booking);

  PERFORM set_config('carelink.test_block_visit_award_delete', 'on', true);
  BEGIN
    PERFORM public.mark_booking_no_show_atomic(v_booking, v_facility, 'completed');
    RAISE EXCEPTION 'EXPECTED_NO_SHOW_CLEANUP_FAILURE';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'BOOKING_ATOMIC_TEST_DELETE_BLOCKED' THEN RAISE; END IF;
  END;
  PERFORM set_config('carelink.test_block_visit_award_delete', 'off', true);
  SELECT COUNT(*) INTO v_count FROM public.bookings WHERE id = v_booking AND status = 'completed';
  IF v_count <> 1 THEN RAISE EXCEPTION 'no_show cleanup failure did not roll back booking status'; END IF;
  SELECT COUNT(*) INTO v_count FROM public.customer_visits WHERE booking_id = v_booking;
  IF v_count <> 1 THEN RAISE EXCEPTION 'no_show cleanup failure did not roll back visit deletion'; END IF;
  v_result := public.mark_booking_no_show_atomic(v_booking, v_facility, 'completed');
  IF v_result->>'updated' <> 'true' THEN RAISE EXCEPTION 'completed→no_show transition failed'; END IF;
  SELECT COUNT(*) INTO v_count FROM public.customer_visits WHERE booking_id = v_booking;
  IF v_count <> 0 THEN RAISE EXCEPTION 'no_show retained customer visit'; END IF;
  SELECT COUNT(*) INTO v_count FROM public.user_points WHERE booking_id = v_booking AND reason = '来店ポイント';
  IF v_count <> 0 THEN RAISE EXCEPTION 'no_show retained visit award'; END IF;
  SELECT COUNT(*) INTO v_count FROM public.user_points WHERE booking_id = v_booking AND points = -20;
  IF v_count <> 1 THEN RAISE EXCEPTION 'no_show deleted the booking-use debit'; END IF;

  PERFORM set_config('carelink.test_block_refund_insert', 'on', true);
  BEGIN
    PERFORM public.cancel_booking_with_points_atomic(v_booking, v_facility, v_user, 'no_show');
    RAISE EXCEPTION 'EXPECTED_REFUND_INSERT_FAILURE';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'EXPECTED_REFUND_INSERT_FAILURE' THEN RAISE; END IF;
    IF SQLERRM <> 'BOOKING_ATOMIC_TEST_REFUND_BLOCKED' OR SQLSTATE <> '23514' THEN RAISE; END IF;
  END;
  PERFORM set_config('carelink.test_block_refund_insert', 'off', true);
  SELECT COUNT(*) INTO v_count FROM public.bookings WHERE id = v_booking AND status = 'no_show';
  IF v_count <> 1 THEN RAISE EXCEPTION 'refund failure did not roll back cancellation status'; END IF;

  v_result := public.cancel_booking_with_points_atomic(v_booking, v_facility, v_user, 'no_show');
  IF v_result->>'cancelled' <> 'true' OR (v_result->>'points_refunded')::INT <> 20 THEN
    RAISE EXCEPTION 'cancellation refund failed: %', v_result;
  END IF;
  v_result := public.cancel_booking_with_points_atomic(v_booking, v_facility, v_user, 'no_show');
  IF v_result->>'cancelled' <> 'false' THEN RAISE EXCEPTION 'duplicate cancellation was not rejected'; END IF;
  SELECT COUNT(*) INTO v_count FROM public.user_points WHERE booking_id = v_booking AND reason = 'キャンセル返還' AND points = 20;
  IF v_count <> 1 THEN RAISE EXCEPTION 'cancellation retry duplicated refund'; END IF;
  BEGIN
    INSERT INTO public.user_points(user_id, points, reason, booking_id)
      VALUES (v_user, 1, 'duplicate credit test', v_booking);
    RAISE EXCEPTION 'EXPECTED_DUPLICATE_CREDIT_REJECTION';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END;
$$;

DROP TRIGGER _carelink_test_block_visit_award_delete ON public.user_points;
DROP FUNCTION public._carelink_test_block_visit_award_delete();
ROLLBACK;
