-- Synthetic fixtures and delay triggers for booking-points-atomic-concurrency.sh.
-- This is only run against the disposable Postgres service in CI.

CREATE OR REPLACE FUNCTION public._carelink_test_pause_booking_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.customer_name LIKE 'Concurrency test%' THEN
    PERFORM pg_sleep(1.5);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER _carelink_test_pause_booking_insert
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public._carelink_test_pause_booking_insert();

CREATE OR REPLACE FUNCTION public._carelink_test_pause_refund_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.reason = 'キャンセル返還' THEN
    PERFORM pg_sleep(1.5);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER _carelink_test_pause_refund_insert
  BEFORE INSERT ON public.user_points
  FOR EACH ROW EXECUTE FUNCTION public._carelink_test_pause_refund_insert();

INSERT INTO auth.users(id, email) VALUES
  ('eeee0000-0000-4000-8000-000000000023', 'booking-concurrency@example.invalid');
INSERT INTO public.facility_profiles(id, name, slug, business_type, prefecture, city, address, status)
  VALUES ('eeee0000-0000-4000-8000-000000000021', 'Concurrency test facility', 'concurrency-test-20260920', 'test', '東京都', 'テスト市', 'テスト住所', 'published');
INSERT INTO public.staff_profiles(id, facility_id, name, slug)
  VALUES ('eeee0000-0000-4000-8000-000000000022', 'eeee0000-0000-4000-8000-000000000021', 'Concurrency test staff', 'concurrency-test-staff');
INSERT INTO public.user_points(user_id, points, reason)
  VALUES ('eeee0000-0000-4000-8000-000000000023', 100, 'atomic concurrency seed');
