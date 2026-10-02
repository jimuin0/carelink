-- Synthetic, rollback-only. No customer service or provider is contacted.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='10s';
DO $$ BEGIN IF current_database() NOT IN ('carelink_shadow','carelink_manual_20261001','carelink_shadow_m09_final_20261001')
  THEN RAISE EXCEPTION 'disposable shadow database required'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_event(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'booking event fixture: %',label; END IF; END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
('e1000000-0000-4000-8000-000000000001','event-owner@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES
('e2000000-0000-4000-8000-000000000001','Event synthetic','event-synthetic','その他','検証県','検証市','検証住所','draft'),
('e2000000-0000-4000-8000-000000000002','Other synthetic','event-other','その他','検証県','検証市','検証住所','draft');
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES
('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','owner');
INSERT INTO public.bookings(id,facility_id,booking_date,start_time,end_time,customer_name,email,status,updated_at) VALUES
('e4000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','2030-01-07','10:00','11:00','Synthetic','event@example.invalid','pending','2026-10-01T00:00:00Z'),
('e4000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001','2030-01-07','11:00','12:00','Synthetic',NULL,'confirmed','2026-10-01T00:00:00Z');
CREATE FUNCTION pg_temp.event_envelope() RETURNS jsonb LANGUAGE sql AS $$ SELECT
  '{"from":"sender@example.invalid","to":"event@example.invalid","subject":"Synthetic only","html":"<p>fixture</p>"}'::jsonb; $$;
CREATE FUNCTION pg_temp.event_save(next_status text DEFAULT NULL) RETURNS TABLE(operation_id uuid,replayed boolean,notification text)
LANGUAGE sql AS $$ SELECT * FROM public.save_booking_email_event_atomic(
 'e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','pending',
 '2026-10-01T00:00:00Z', next_status,pg_temp.event_envelope(),'e5000000-0000-4000-8000-000000000001'); $$;
SELECT pg_temp.assert_event(has_function_privilege('service_role','public.save_booking_email_event_atomic(uuid,uuid,text,timestamptz,text,jsonb,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.save_booking_email_event_atomic(uuid,uuid,text,timestamptz,text,jsonb,uuid)','EXECUTE')
 AND NOT has_table_privilege('authenticated','public.booking_adjust_operations','SELECT')
 AND NOT has_function_privilege('authenticated','public.set_facilities_publication_atomic(uuid,uuid[],boolean)','EXECUTE'), 'server-only operations');
SET LOCAL ROLE service_role;
DO $$ DECLARE first uuid; second uuid; repeated boolean; BEGIN
 SELECT operation_id INTO first FROM pg_temp.event_save();
 SELECT operation_id,replayed INTO second,repeated FROM pg_temp.event_save();
 PERFORM pg_temp.assert_event(first = second AND repeated,'HTTP replay shares one adjustment event');
 PERFORM pg_temp.assert_event((SELECT count(*)=1 FROM public.webhook_retry_queue WHERE booking_event_id='e4000000-0000-4000-8000-000000000001'),'no second provider identity');
 SELECT operation_id INTO second FROM pg_temp.event_save('confirmed');
 PERFORM pg_temp.assert_event(first <> second AND (SELECT status='confirmed' FROM public.bookings
  WHERE id='e4000000-0000-4000-8000-000000000001'),'state and status event saved atomically');
 PERFORM pg_temp.assert_event((SELECT count(*)=2 FROM public.webhook_retry_queue WHERE booking_event_id='e4000000-0000-4000-8000-000000000001'),'one adjustment and one status event');
 SELECT operation_id,replayed INTO second,repeated FROM pg_temp.event_save();
 PERFORM pg_temp.assert_event(first=second AND repeated,'old HTTP operation survives a new booking revision');
 UPDATE public.webhook_retry_queue SET status='processing',claimed_at='2026-10-01T00:01:00Z' WHERE id=first;
 PERFORM pg_temp.assert_event((SELECT outcome='superseded' FROM public.start_booking_email_event(first,'2026-10-01T00:01:00Z')),'obsolete event cannot start delivery');
 PERFORM pg_temp.assert_event((SELECT status='cancelled' AND delivery_started_at IS NULL FROM public.webhook_retry_queue WHERE id=first),'superseded is cancelled, not success or sent');
 SELECT id INTO second FROM public.webhook_retry_queue WHERE booking_event_id='e4000000-0000-4000-8000-000000000001' AND booking_event_kind='status';
 UPDATE public.webhook_retry_queue SET status='processing',claimed_at='2026-10-01T00:01:00Z' WHERE id=second;
 PERFORM pg_temp.assert_event((SELECT outcome='ready' AND started_at IS NOT NULL FROM public.start_booking_email_event(second,'2026-10-01T00:01:00Z')),'current status event fenced');
 PERFORM pg_temp.assert_event((SELECT outcome='not_owned' FROM public.start_booking_email_event(second,'2026-10-01T00:01:00Z')),'started event never reclaimed/repeated');
 BEGIN PERFORM pg_temp.event_save('confirmed'); RAISE EXCEPTION 'stale transition accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'BOOKING_REVISION_CONFLICT' THEN RAISE; END IF; END;
 BEGIN UPDATE public.webhook_retry_queue SET booking_event_revision=now() WHERE id=first;
  RAISE EXCEPTION 'identity rewrite accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'BOOKING_EMAIL_EVENT_IMMUTABLE' THEN RAISE; END IF; END;
 PERFORM public.save_booking_email_event_atomic('e1000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000002','confirmed','2026-10-01T00:00:00Z','arrived',NULL);
 PERFORM pg_temp.assert_event(NOT EXISTS(SELECT 1 FROM public.webhook_retry_queue
  WHERE booking_event_id='e4000000-0000-4000-8000-000000000002'),'no email for internal arrival/NULL email');
 PERFORM public.set_facilities_publication_atomic('e1000000-0000-4000-8000-000000000001',
  ARRAY['e2000000-0000-4000-8000-000000000001'::uuid],true);
 PERFORM pg_temp.assert_event((SELECT status='published' FROM public.facility_profiles WHERE id='e2000000-0000-4000-8000-000000000001'),'listing needs no booking catalog');
 BEGIN PERFORM public.set_facilities_publication_atomic('e1000000-0000-4000-8000-000000000001',
   ARRAY['e2000000-0000-4000-8000-000000000001'::uuid,'e2000000-0000-4000-8000-000000000002'::uuid],false);
  RAISE EXCEPTION 'cross tenant partial publish accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'FACILITY_PERMISSION_REVOKED' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_event((SELECT status='published' FROM public.facility_profiles WHERE id='e2000000-0000-4000-8000-000000000001'),'cross tenant batch changes nothing');
 UPDATE public.facility_profiles SET status='suspended' WHERE id='e2000000-0000-4000-8000-000000000001';
 PERFORM public.update_facility_settings_atomic('e1000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001','{"status":"published"}'::jsonb);
 PERFORM pg_temp.assert_event((SELECT status='published' FROM public.facility_profiles WHERE id='e2000000-0000-4000-8000-000000000001'),'normal suspended listing can resume');
 UPDATE public.facility_members SET role='admin' WHERE user_id='e1000000-0000-4000-8000-000000000001';
 BEGIN PERFORM public.set_facilities_publication_atomic('e1000000-0000-4000-8000-000000000001',
  ARRAY['e2000000-0000-4000-8000-000000000001'::uuid],true); RAISE EXCEPTION 'ownerless facility reopened';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'FACILITY_OWNER_REQUIRED' THEN RAISE; END IF; END;
 BEGIN PERFORM public.update_facility_settings_atomic('e1000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001','{"status":"published"}'::jsonb); RAISE EXCEPTION 'settings reopened ownerless facility';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'FACILITY_OWNER_REQUIRED' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_event((SELECT status='suspended' FROM public.facility_profiles WHERE id='e2000000-0000-4000-8000-000000000001'),'last-owner revocation stays suspended');
 UPDATE public.facility_members SET role='owner' WHERE user_id='e1000000-0000-4000-8000-000000000001';
 PERFORM public.set_facilities_publication_atomic('e1000000-0000-4000-8000-000000000001',
  ARRAY['e2000000-0000-4000-8000-000000000001'::uuid],true);
 PERFORM pg_temp.assert_event((SELECT status='published' FROM public.facility_profiles WHERE id='e2000000-0000-4000-8000-000000000001'),'legitimate owner reinstatement can republish');
END $$;
RESET ROLE;
DO $$ BEGIN
 BEGIN DELETE FROM auth.users WHERE id='e1000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'owner retirement with active reservation accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'ACCOUNT_ACTIVE_BOOKINGS_PREVENT_DELETION' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_event(EXISTS(SELECT 1 FROM auth.users WHERE id='e1000000-0000-4000-8000-000000000001')
   AND EXISTS(SELECT 1 FROM public.facility_members WHERE user_id='e1000000-0000-4000-8000-000000000001' AND role='owner'),
   'rejected retirement preserves Auth and ownership in one transaction');
END $$;
CREATE FUNCTION pg_temp.reject_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'SYNTHETIC_EVENT_FAILURE'; END $$;
CREATE TRIGGER synthetic_event_failure BEFORE INSERT ON public.webhook_retry_queue
 FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_event();
SET LOCAL ROLE service_role;
DO $$ DECLARE rev timestamptz; BEGIN
 SELECT updated_at INTO rev FROM public.bookings WHERE id='e4000000-0000-4000-8000-000000000001';
 BEGIN PERFORM public.save_booking_email_event_atomic('e1000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001','confirmed',rev,'cancelled',pg_temp.event_envelope());
  RAISE EXCEPTION 'state without outbox accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'SYNTHETIC_EVENT_FAILURE' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_event((SELECT status='confirmed' AND updated_at=rev FROM public.bookings
  WHERE id='e4000000-0000-4000-8000-000000000001'),'outbox failure rolls back state/revision');
END $$;
RESET ROLE;
DROP TRIGGER synthetic_event_failure ON public.webhook_retry_queue;
UPDATE public.facility_members SET role='staff' WHERE user_id='e1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.set_facilities_publication_atomic('e1000000-0000-4000-8000-000000000001',
  ARRAY['e2000000-0000-4000-8000-000000000001'::uuid],false); RAISE EXCEPTION 'revoked publication accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'FACILITY_PERMISSION_REVOKED' THEN RAISE; END IF; END;
 BEGIN PERFORM pg_temp.event_save(); RAISE EXCEPTION 'revoked notification accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'BOOKING_PERMISSION_DENIED' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('e1000000-0000-4000-8000-000000000002','retiring@example.invalid',now());
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES
 ('e1000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000002','owner');
UPDATE public.facility_profiles SET status='published' WHERE id='e2000000-0000-4000-8000-000000000002';
DELETE FROM auth.users WHERE id='e1000000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_event((SELECT status='suspended' FROM public.facility_profiles
 WHERE id='e2000000-0000-4000-8000-000000000002'),'Auth cascade suspends last-owned listing atomically');
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.update_facility_settings_atomic('e1000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001','{"name":"stale writer"}'::jsonb); RAISE EXCEPTION 'revoked settings saved';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'FACILITY_PERMISSION_REVOKED' THEN RAISE; END IF; END;
END $$;
ROLLBACK;
