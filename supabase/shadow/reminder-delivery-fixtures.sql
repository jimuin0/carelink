-- Disposable CI shadow DB only. No provider calls; all synthetic rows roll back.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'carelink_shadow' THEN
    RAISE EXCEPTION 'reminder fixtures require the disposable carelink_shadow database';
  END IF;
  IF EXISTS (SELECT 1 FROM public.bookings) THEN
    RAISE EXCEPTION 'reminder fixtures require an empty bookings table';
  END IF;
END $$;

CREATE FUNCTION pg_temp.assert_reminder(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'reminder fixture failed: %', label; END IF;
END $$;

INSERT INTO public.facility_profiles (id, name, slug, business_type, prefecture, city, address)
SELECT ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  'synthetic reminder fixture', 'reminder-fixture-' || n, 'salon', 'fixture', 'fixture', 'fixture'
FROM generate_series(1, 3) n;
INSERT INTO public.facility_reminder_settings
  (facility_id, remind_7d_email, remind_3d_email, remind_7d_line, remind_3d_line)
SELECT id, true, true, true, true FROM public.facility_profiles WHERE slug IN ('reminder-fixture-2', 'reminder-fixture-3');
INSERT INTO public.facility_entitlements (facility_id, option_key)
VALUES ('10000000-0000-0000-0000-000000000003', 'reminder_email_3d'),
       ('10000000-0000-0000-0000-000000000003', 'reminder_line');
INSERT INTO auth.users (id, email)
VALUES ('20000000-0000-0000-0000-000000000001', 'reminder-fixture@example.invalid'),
       ('20000000-0000-0000-0000-000000000002', 'empty-fixture@example.invalid');
UPDATE public.profiles SET line_user_id = 'synthetic-line-id' WHERE id = '20000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET line_user_id = '' WHERE id = '20000000-0000-0000-0000-000000000002';

INSERT INTO public.bookings (id, facility_id, user_id, booking_date, start_time, end_time, customer_name, email, status)
SELECT ('30000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  ('10000000-0000-0000-0000-' || lpad(facility::text, 12, '0'))::uuid,
  CASE WHEN recipient IS NOT NULL THEN ('20000000-0000-0000-0000-' || lpad(recipient::text, 12, '0'))::uuid END,
  DATE '2030-01-01' + days, '10:00', '11:00', 'synthetic fixture', email, status
FROM (VALUES
  (1, 1, NULL::int, 1, 'fixture@example.invalid', 'confirmed'),
  (2, 1, NULL, 1, '', 'confirmed'),
  (3, 1, NULL, 1, NULL, 'confirmed'),
  (4, 1, NULL, 1, 'fixture@example.invalid', 'cancelled'),
  (5, 1, NULL, 2, 'fixture@example.invalid', 'confirmed'),
  (6, 1, NULL, 7, 'fixture@example.invalid', 'confirmed'),
  (7, 2, NULL, 3, 'fixture@example.invalid', 'confirmed'),
  (8, 2, NULL, 7, 'fixture@example.invalid', 'confirmed'),
  (9, 3, NULL, 3, 'fixture@example.invalid', 'confirmed'),
  (10, 3, 1, 3, NULL, 'confirmed'),
  (11, 3, 2, 3, NULL, 'confirmed'),
  (12, 3, 1, 7, 'fixture@example.invalid', 'confirmed')
) AS fixture(n, facility, recipient, days, email, status);

SET LOCAL ROLE service_role;
SELECT pg_temp.assert_reminder(
  (SELECT array_agg(right(id::text, 2) ORDER BY id) FROM public.pending_booking_reminders('2030-01-01'))
    = ARRAY['01','08','09','10','12'], 'date/settings/entitlement/empty-recipient candidate matrix');
RESET ROLE;

UPDATE public.bookings SET status = 'cancelled' WHERE id = '30000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_reminder(
  NOT EXISTS (SELECT 1 FROM public.pending_booking_reminders('2030-01-01') WHERE id = '30000000-0000-0000-0000-000000000001'),
  'cancellation removes candidate');
UPDATE public.bookings SET status = 'confirmed', booking_date = '2030-01-03' WHERE id = '30000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_reminder(
  NOT EXISTS (SELECT 1 FROM public.pending_booking_reminders('2030-01-01') WHERE id = '30000000-0000-0000-0000-000000000001'),
  'reschedule removes candidate');
UPDATE public.bookings SET booking_date = '2030-01-02' WHERE id = '30000000-0000-0000-0000-000000000001';
UPDATE public.facility_entitlements SET status = 'canceled' WHERE facility_id = '10000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert_reminder(
  NOT EXISTS (SELECT 1 FROM public.pending_booking_reminders('2030-01-01') WHERE id IN
    ('30000000-0000-0000-0000-000000000009', '30000000-0000-0000-0000-000000000010')),
  'canceled entitlements remove paid-channel candidates');
UPDATE public.facility_entitlements SET status = 'active' WHERE facility_id = '10000000-0000-0000-0000-000000000003';

-- Each delivery state blocks its own slot; a different kind/date must not block it.
INSERT INTO public.bookings (id, facility_id, booking_date, start_time, end_time, customer_name, email, status)
SELECT ('40000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  '10000000-0000-0000-0000-000000000001', '2030-01-02', '10:00', '11:00', 'synthetic claim', 'fixture@example.invalid', 'confirmed'
FROM generate_series(1, 8) n;
INSERT INTO public.sent_reminders (booking_id, reminder_date, kind, delivery_state)
SELECT ('40000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  CASE WHEN n = 7 THEN DATE '2030-01-03' ELSE DATE '2030-01-02' END,
  CASE WHEN n = 8 THEN 'email_7d' ELSE 'email_1d' END, state
FROM (VALUES (1,'legacy'), (2,'claimed'), (3,'delivering'), (4,'delivered'), (5,'closed'), (6,'uncertain'), (7,'delivered'), (8,'delivered')) v(n,state);
SELECT pg_temp.assert_reminder(
  (SELECT count(*) FROM public.pending_booking_reminders('2030-01-01') WHERE id::text LIKE '40000000%') = 2,
  'all claim states excluded, other date/kind retained');
INSERT INTO public.sent_reminders (booking_id, reminder_date, kind)
VALUES ('30000000-0000-0000-0000-000000000012', '2030-01-08', 'email_7d');
SELECT pg_temp.assert_reminder(
  EXISTS (SELECT 1 FROM public.pending_booking_reminders('2030-01-01') WHERE id = '30000000-0000-0000-0000-000000000012'),
  'unclaimed second channel remains eligible');
INSERT INTO public.sent_reminders (booking_id, reminder_date, kind)
VALUES ('30000000-0000-0000-0000-000000000012', '2030-01-08', 'line_7d');
SELECT pg_temp.assert_reminder(
  NOT EXISTS (SELECT 1 FROM public.pending_booking_reminders('2030-01-01') WHERE id = '30000000-0000-0000-0000-000000000012'),
  'all channels claimed removes booking');
SELECT pg_temp.assert_reminder(
  (SELECT bool_and(delivery_state = 'legacy') FROM public.sent_reminders WHERE booking_id = '30000000-0000-0000-0000-000000000012'),
  'old inserts default to legacy');

-- A claimed prefix larger than the route cap must not starve later candidates.
INSERT INTO public.bookings (id, facility_id, booking_date, start_time, end_time, customer_name, email, status)
SELECT ('50000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  '10000000-0000-0000-0000-000000000001', '2030-01-02', '10:00', '11:00', 'synthetic batch', 'fixture@example.invalid', 'confirmed'
FROM generate_series(1, 5001) n;
INSERT INTO public.sent_reminders (booking_id, reminder_date, kind, delivery_state)
SELECT id, booking_date, 'email_1d', 'delivered' FROM public.bookings
WHERE id::text LIKE '50000000%' AND id <> '50000000-0000-0000-0000-000000005001';
SELECT pg_temp.assert_reminder(
  EXISTS (SELECT 1 FROM (SELECT id FROM public.pending_booking_reminders('2030-01-01') ORDER BY id LIMIT 5000) q
    WHERE id = '50000000-0000-0000-0000-000000005001'), 'claimed prefix is excluded before limit');

-- Actual role invocations (not just catalog ACL inspection).
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.pending_booking_reminders('2030-01-01');
    RAISE EXCEPTION 'anon unexpectedly executed reminder RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS (SELECT 1 FROM public.sent_reminders) THEN RAISE EXCEPTION 'anon read delivery claims'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.pending_booking_reminders('2030-01-01');
    RAISE EXCEPTION 'authenticated unexpectedly executed reminder RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS (SELECT 1 FROM public.sent_reminders) THEN RAISE EXCEPTION 'authenticated read delivery claims'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ DECLARE winners int; BEGIN
  WITH claim AS (
    INSERT INTO public.sent_reminders (booking_id, reminder_date, kind, delivery_state)
    VALUES ('30000000-0000-0000-0000-000000000001', '2030-01-02', 'email_1d', 'claimed')
    ON CONFLICT (booking_id, reminder_date, kind) DO NOTHING RETURNING id
  ) SELECT count(*) INTO winners FROM claim;
  IF winners <> 1 THEN RAISE EXCEPTION 'first claimant did not win'; END IF;
  WITH claim AS (
    INSERT INTO public.sent_reminders (booking_id, reminder_date, kind, delivery_state)
    VALUES ('30000000-0000-0000-0000-000000000001', '2030-01-02', 'email_1d', 'claimed')
    ON CONFLICT (booking_id, reminder_date, kind) DO NOTHING RETURNING id
  ) SELECT count(*) INTO winners FROM claim;
  IF winners <> 0 THEN RAISE EXCEPTION 'duplicate claimant won'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
\echo 'reminder delivery fixtures passed (synthetic transaction rolled back)'
