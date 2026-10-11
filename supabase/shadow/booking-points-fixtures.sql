-- Synthetic money invariants. Local/shadow DB only; every fixture is rolled back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN IF current_database() NOT IN ('carelink_shadow','carelink_shadow_batch2_points','postgres') THEN RAISE EXCEPTION 'isolated database required'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_points(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'booking point fixture: %',label; END IF; END $$;
SELECT pg_temp.assert_points(NOT has_function_privilege('anon','public.booking_points_atomic_version()','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.booking_points_atomic_version()','EXECUTE')
  AND has_function_privilege('service_role','public.booking_points_atomic_version()','EXECUTE'),'points readiness server-only');
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_points(public.booking_points_atomic_version()=1,'service readiness confirms both installed guards');
RESET ROLE;
ALTER TABLE public.bookings DISABLE TRIGGER booking_points_atomic;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_points(public.booking_points_atomic_version()=0,'disabled booking guard fails readiness');
RESET ROLE;
ALTER TABLE public.bookings ENABLE TRIGGER booking_points_atomic;
ALTER TABLE public.user_points DISABLE TRIGGER user_points_serialize;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_points(public.booking_points_atomic_version()=0,'disabled ledger guard fails readiness');
RESET ROLE;
ALTER TABLE public.user_points ENABLE TRIGGER user_points_serialize;
CREATE FUNCTION pg_temp.wrong_point_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE OR REPLACE TRIGGER booking_points_atomic AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION pg_temp.wrong_point_guard();
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_points(public.booking_points_atomic_version()=0,'wrong booking trigger function fails readiness');
RESET ROLE;
CREATE OR REPLACE TRIGGER booking_points_atomic AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.sync_booking_points();
CREATE OR REPLACE TRIGGER user_points_serialize BEFORE INSERT OR UPDATE OR DELETE ON public.user_points
  FOR EACH ROW EXECUTE FUNCTION pg_temp.wrong_point_guard();
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_points(public.booking_points_atomic_version()=0,'wrong ledger trigger function fails readiness');
RESET ROLE;
CREATE OR REPLACE TRIGGER user_points_serialize BEFORE INSERT OR UPDATE OR DELETE ON public.user_points
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_point_ledger();
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_points(public.booking_points_atomic_version()=1,'restored guards reopen readiness');
RESET ROLE;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('fc110000-0000-4000-8000-000000000001','points-owner@example.invalid',now()),
 ('fc110000-0000-4000-8000-000000000002','points-customer@example.invalid',now()),
 ('fc110000-0000-4000-8000-000000000003','points-empty@example.invalid',now()),
 ('fc110000-0000-4000-8000-000000000004','points-referrer@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
 VALUES('fc120000-0000-4000-8000-000000000001','Points synthetic','points-synthetic','その他','検証県','検証市','検証住所','draft');
INSERT INTO public.facility_members(user_id,facility_id,role)
 VALUES('fc110000-0000-4000-8000-000000000001','fc120000-0000-4000-8000-000000000001','owner');
INSERT INTO public.user_points(user_id,points,reason) VALUES('fc110000-0000-4000-8000-000000000002',1000,'Synthetic seed');
INSERT INTO public.facility_menus(id,facility_id,category,name,price,duration_minutes,is_published) VALUES
 ('fc150000-0000-4000-8000-000000000001','fc120000-0000-4000-8000-000000000001','synthetic','First',500,30,true),
 ('fc150000-0000-4000-8000-000000000002','fc120000-0000-4000-8000-000000000001','synthetic','Second',500,30,true);
INSERT INTO public.staff_profiles(id,facility_id,name,slug,is_active) VALUES
 ('fc160000-0000-4000-8000-000000000001','fc120000-0000-4000-8000-000000000001','Synthetic','points-staff',true);
INSERT INTO public.staff_schedules(staff_id,day_of_week,start_time,end_time) VALUES
 ('fc160000-0000-4000-8000-000000000001',1,'09:00','17:00');
INSERT INTO public.facility_photos(facility_id,photo_url,photo_type)
 VALUES('fc120000-0000-4000-8000-000000000001','https://example.invalid/points.jpg','other');
UPDATE public.facility_profiles SET status='published',business_hours='{"mon":{"open":"09:00","close":"17:00"},"tue":null,"wed":null,"thu":null,"fri":null,"sat":null,"sun":null}'
 WHERE id='fc120000-0000-4000-8000-000000000001';
CREATE FUNCTION pg_temp.fail_full_menu() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.facility_id='fc120000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'SYNTHETIC_MENU_SAVE_FAILURE'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_menu_save_failure BEFORE UPDATE OF menu_ids ON public.bookings FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_full_menu();
-- The internal primitive remains owner-only behind the receipt wrapper.
RESET ROLE;
DO $$ BEGIN
 BEGIN PERFORM public.create_online_booking_atomic('fc120000-0000-4000-8000-000000000001','fc160000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000002',
  'fc150000-0000-4000-8000-000000000001',NULL,'2030-01-07','15:00','16:00','Synthetic',NULL,NULL,NULL,900,100,'confirmed',
  ARRAY['fc150000-0000-4000-8000-000000000001'::uuid,'fc150000-0000-4000-8000-000000000002'::uuid]);
  RAISE EXCEPTION 'partial menu booking accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_MENU_SAVE_FAILURE' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_points(NOT EXISTS(SELECT 1 FROM public.bookings WHERE facility_id='fc120000-0000-4000-8000-000000000001')
  AND (SELECT sum(points)=1000 FROM public.user_points WHERE user_id='fc110000-0000-4000-8000-000000000002'),'full-menu persistence failure rolls back booking AND debit');
END $$;
RESET ROLE;
DROP TRIGGER synthetic_menu_save_failure ON public.bookings;
SET LOCAL ROLE service_role;
INSERT INTO public.bookings(id,facility_id,user_id,booking_date,start_time,end_time,customer_name,email,status,total_price,points_used)
 VALUES('fc130000-0000-4000-8000-000000000001','fc120000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000002','2030-01-07','10:00','11:00','Synthetic',NULL,'confirmed',700,300);
SELECT pg_temp.assert_points((SELECT sum(points)=700 FROM public.user_points WHERE user_id='fc110000-0000-4000-8000-000000000002'),'booking and debit commit together');
-- Old application performs its now-obsolete second write. Return a receipt,
-- retain exact typed debit and balance, and never turn a failed debit into zero.
INSERT INTO public.user_points(user_id,points,reason) VALUES('fc110000-0000-4000-8000-000000000002',-300,'予約利用 (fc130000)');
SELECT pg_temp.assert_points((SELECT sum(points)=700 AND count(*) FILTER(WHERE points=0)=1 FROM public.user_points WHERE user_id='fc110000-0000-4000-8000-000000000002'),'old app second debit is a zero-value receipt');
DO $$ BEGIN
 BEGIN INSERT INTO public.bookings(id,facility_id,user_id,booking_date,start_time,end_time,customer_name,email,status,total_price,points_used)
  VALUES('fc130000-0000-4000-8000-000000000002','fc120000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000003','2030-01-07','11:00','12:00','Synthetic',NULL,'confirmed',0,1);
  RAISE EXCEPTION 'empty balance spent';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'POINTS_INSUFFICIENT' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_points(NOT EXISTS(SELECT 1 FROM public.bookings WHERE id='fc130000-0000-4000-8000-000000000002'),'empty ledger insufficiency leaves no booking');
END $$;
SELECT * FROM public.complete_booking_with_points_atomic('fc110000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000001','confirmed');
SELECT pg_temp.assert_points((SELECT sum(points)=707 FROM public.user_points WHERE user_id='fc110000-0000-4000-8000-000000000002')
 AND EXISTS(SELECT 1 FROM public.customer_visits WHERE booking_id='fc130000-0000-4000-8000-000000000001'),'complete+visit+award commit together');
INSERT INTO public.user_points(user_id,points,reason,booking_id) VALUES('fc110000-0000-4000-8000-000000000002',7,'来店ポイント','fc130000-0000-4000-8000-000000000001');
UPDATE public.bookings SET status='completed' WHERE id='fc130000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_points((SELECT sum(points)=707 FROM public.user_points WHERE user_id='fc110000-0000-4000-8000-000000000002'),'old helper and repeated completion never duplicate award');
DO $$ BEGIN
 PERFORM pg_temp.assert_points((SELECT replayed=true FROM public.complete_booking_with_points_atomic('fc110000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000001','confirmed')),'completed replay is verified and does not award twice');
END $$;
-- Public API/RPC matrix explicitly forbids undo-to-active/recompletion.
DO $$ DECLARE target text; round int; BEGIN
 FOR round IN 1..2 LOOP
  FOREACH target IN ARRAY ARRAY['confirmed','arrived'] LOOP
   BEGIN PERFORM public.save_booking_email_event_atomic('fc110000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000001','completed',
    (SELECT updated_at FROM public.bookings WHERE id='fc130000-0000-4000-8000-000000000001'),target,NULL);
    RAISE EXCEPTION 'forbidden completion undo accepted';
   EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'INVALID_BOOKING_TRANSITION' THEN RAISE; END IF; END;
  END LOOP;
 END LOOP;
 PERFORM pg_temp.assert_points((SELECT status='completed' FROM public.bookings WHERE id='fc130000-0000-4000-8000-000000000001')
  AND (SELECT count(*)=1 FROM public.user_points WHERE booking_id='fc130000-0000-4000-8000-000000000001' AND booking_operation='award'),'forbidden undo leaves one award and completed state');
END $$;
SELECT * FROM public.save_booking_email_event_atomic('fc110000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000001','completed',
 (SELECT updated_at FROM public.bookings WHERE id='fc130000-0000-4000-8000-000000000001'),'no_show',NULL);
DO $$ DECLARE round int; BEGIN
 FOR round IN 1..2 LOOP
  BEGIN PERFORM public.complete_booking_with_points_atomic('fc110000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000001','confirmed');
   RAISE EXCEPTION 'forbidden recompletion accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_REVISION_CONFLICT' THEN RAISE; END IF; END;
 END LOOP;
END $$;
DELETE FROM public.user_points WHERE booking_id='fc130000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_points((SELECT sum(points)=700 FROM public.user_points WHERE user_id='fc110000-0000-4000-8000-000000000002')
 AND (SELECT count(*)=3 FROM public.user_points WHERE booking_id='fc130000-0000-4000-8000-000000000001')
 AND NOT EXISTS(SELECT 1 FROM public.customer_visits WHERE booking_id='fc130000-0000-4000-8000-000000000001'),'reversal preserves debit/award and old DELETE cannot erase them');
SELECT * FROM public.save_booking_email_event_atomic('fc110000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000001','no_show',
 (SELECT updated_at FROM public.bookings WHERE id='fc130000-0000-4000-8000-000000000001'),'cancelled',NULL);
DO $$ DECLARE target text; round int; BEGIN
 FOR round IN 1..2 LOOP
  FOREACH target IN ARRAY ARRAY['confirmed','arrived','completed','no_show'] LOOP
   BEGIN PERFORM public.save_booking_email_event_atomic('fc110000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000001','cancelled',
    (SELECT updated_at FROM public.bookings WHERE id='fc130000-0000-4000-8000-000000000001'),target,NULL);
    RAISE EXCEPTION 'forbidden cancellation restore accepted';
   EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'INVALID_BOOKING_TRANSITION' THEN RAISE; END IF; END;
  END LOOP;
 END LOOP;
 PERFORM pg_temp.assert_points((SELECT status='cancelled' FROM public.bookings WHERE id='fc130000-0000-4000-8000-000000000001')
  AND (SELECT count(*)=4 FROM public.user_points WHERE booking_id='fc130000-0000-4000-8000-000000000001'),'forbidden restore leaves immutable debit/award/reversal/refund');
END $$;
INSERT INTO public.user_points(user_id,points,reason,booking_id) VALUES('fc110000-0000-4000-8000-000000000002',300,'キャンセル返還','fc130000-0000-4000-8000-000000000001');
SELECT pg_temp.assert_points((SELECT sum(points)=1000 FROM public.user_points WHERE user_id='fc110000-0000-4000-8000-000000000002'),'no-show-to-cancel refunds debit exactly once; old helper is receipt');
DO $$ BEGIN
 BEGIN INSERT INTO public.user_points(user_id,points,reason,booking_id)
  VALUES('fc110000-0000-4000-8000-000000000002',200,'キャンセル返還','fc130000-0000-4000-8000-000000000001'); RAISE EXCEPTION 'mismatched refund silently receipted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'POINTS_LEGACY_RECONCILIATION_REQUIRED' THEN RAISE; END IF; END;
 BEGIN INSERT INTO public.user_points(user_id,points,reason,booking_id)
  VALUES('fc110000-0000-4000-8000-000000000003',300,'キャンセル返還','fc130000-0000-4000-8000-000000000001'); RAISE EXCEPTION 'wrong user refund accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'POINTS_LEGACY_RECONCILIATION_REQUIRED' THEN RAISE; END IF; END;
 BEGIN INSERT INTO public.user_points(user_id,points,reason)
  VALUES('fc110000-0000-4000-8000-000000000002',-200,'予約利用 (fc130000)'); RAISE EXCEPTION 'mismatched debit silently receipted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'POINTS_LEGACY_RECONCILIATION_REQUIRED' THEN RAISE; END IF; END;
END $$;
-- Failure injection: point insertion throws, so no committed completed state or visit.
INSERT INTO public.bookings(id,facility_id,user_id,booking_date,start_time,end_time,customer_name,email,status,total_price,points_used)
 VALUES('fc130000-0000-4000-8000-000000000003','fc120000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000002','2030-01-07','12:00','13:00','Synthetic',NULL,'confirmed',800,200);
RESET ROLE;
CREATE FUNCTION pg_temp.fail_points() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.booking_operation IN ('award','refund','reversal') THEN RAISE EXCEPTION 'SYNTHETIC_POINT_FAILURE'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_points_failure BEFORE INSERT ON public.user_points FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_points();
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.complete_booking_with_points_atomic('fc110000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000003','confirmed'); RAISE EXCEPTION 'failed award accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_POINT_FAILURE' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_points((SELECT status='confirmed' FROM public.bookings WHERE id='fc130000-0000-4000-8000-000000000003')
  AND NOT EXISTS(SELECT 1 FROM public.customer_visits WHERE booking_id='fc130000-0000-4000-8000-000000000003'),'award failure rolls back status/visit');
 BEGIN PERFORM public.cancel_booking_with_points_atomic('fc110000-0000-4000-8000-000000000002','fc130000-0000-4000-8000-000000000003','confirmed'); RAISE EXCEPTION 'failed refund accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_POINT_FAILURE' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_points((SELECT status='confirmed' FROM public.bookings WHERE id='fc130000-0000-4000-8000-000000000003')
  AND (SELECT sum(points)=800 FROM public.user_points WHERE user_id='fc110000-0000-4000-8000-000000000002'),'refund failure rolls back cancellation');
END $$;
RESET ROLE;
DROP TRIGGER synthetic_points_failure ON public.user_points;
SET LOCAL ROLE service_role;
-- JSON null/missing type cannot bypass an IF condition through SQL NULL logic.
DO $$ DECLARE bad jsonb; BEGIN
 FOR bad IN SELECT value FROM jsonb_array_elements('[{"name":"Synthetic","amount":5000},{"type":null,"name":"Synthetic","amount":5000},{"type":{},"name":"Synthetic","amount":5000},{"type":"menu","name":{},"amount":5000}]') LOOP
  BEGIN PERFORM public.checkout_booking_with_points_atomic('fc110000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000003','confirmed',
   (SELECT updated_at FROM public.bookings WHERE id='fc130000-0000-4000-8000-000000000003'),jsonb_build_array(bad),5000,true);
   RAISE EXCEPTION 'malformed checkout accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'INVALID_BOOKING_CHARGES' THEN RAISE; END IF; END;
 END LOOP;
 PERFORM pg_temp.assert_points((SELECT status='confirmed' AND total_price=800 FROM public.bookings WHERE id='fc130000-0000-4000-8000-000000000003')
  AND NOT EXISTS(SELECT 1 FROM public.customer_visits WHERE booking_id='fc130000-0000-4000-8000-000000000003'),'malformed charge rolls back booking/visit');
END $$;
SELECT * FROM public.checkout_booking_with_points_atomic('fc110000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000003','confirmed',
 (SELECT updated_at FROM public.bookings WHERE id='fc130000-0000-4000-8000-000000000003'),
 '[{"type":"menu","name":"Synthetic","amount":5000},{"type":"discount","name":"Synthetic","amount":-200}]',5000,true);
SELECT pg_temp.assert_points((SELECT total_price=4800 AND status='completed' FROM public.bookings WHERE id='fc130000-0000-4000-8000-000000000003')
 AND (SELECT points=48 FROM public.user_points WHERE booking_id='fc130000-0000-4000-8000-000000000003' AND booking_operation='award')
 AND (SELECT amount=4800 FROM public.customer_visits WHERE booking_id='fc130000-0000-4000-8000-000000000003'),'checkout final amount atomically drives visit and points');
DO $$ BEGIN
 BEGIN PERFORM public.complete_booking_with_points_atomic('fc110000-0000-4000-8000-000000000004','fc130000-0000-4000-8000-000000000003','completed'); RAISE EXCEPTION 'non-member completion accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_PERMISSION_DENIED' THEN RAISE; END IF; END;
 BEGIN PERFORM public.cancel_booking_with_points_atomic('fc110000-0000-4000-8000-000000000003','fc130000-0000-4000-8000-000000000003','completed'); RAISE EXCEPTION 'wrong customer cancel accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'BOOKING_PERMISSION_DENIED' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
ALTER TABLE public.bookings DISABLE TRIGGER booking_points_atomic;
INSERT INTO public.bookings(id,facility_id,user_id,booking_date,start_time,end_time,customer_name,email,status,total_price,points_used)
 VALUES('fc130000-0000-4000-8000-000000000004','fc120000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000002','2030-01-07','14:00','15:00','Synthetic legacy uncertainty',NULL,'confirmed',700,300);
ALTER TABLE public.bookings ENABLE TRIGGER booking_points_atomic;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_points(EXISTS(SELECT 1 FROM public.booking_point_legacy_issues() WHERE booking_id='fc130000-0000-4000-8000-000000000004' AND issue='missing_or_ambiguous_debit'),'legacy uncertainty is observable');
DO $$ BEGIN
 BEGIN PERFORM public.cancel_booking_with_points_atomic('fc110000-0000-4000-8000-000000000002','fc130000-0000-4000-8000-000000000004','confirmed'); RAISE EXCEPTION 'unverified refund minted points';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'POINTS_LEGACY_RECONCILIATION_REQUIRED' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_points((SELECT status='confirmed' FROM public.bookings WHERE id='fc130000-0000-4000-8000-000000000004'),'uncertain legacy refund leaves status unchanged');
END $$;
-- Existing referral bonus is atomic, replay-safe and not claim-then-partial-insert.
RESET ROLE;
INSERT INTO public.referral_codes(user_id,code,used_count)
 VALUES('fc110000-0000-4000-8000-000000000004','SYNTHETIC',0);
INSERT INTO public.referral_uses(id,code,referred_user_id,referrer_user_id,points_awarded)
 VALUES('fc140000-0000-4000-8000-000000000001','SYNTHETIC','fc110000-0000-4000-8000-000000000002','fc110000-0000-4000-8000-000000000004',false);
CREATE FUNCTION pg_temp.fail_referral() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.reason='紹介コード利用ボーナス' THEN RAISE EXCEPTION 'SYNTHETIC_REFERRAL_FAILURE'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_referral_failure BEFORE INSERT ON public.user_points FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_referral();
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.award_referral_points_atomic('fc110000-0000-4000-8000-000000000002'); RAISE EXCEPTION 'partial referral accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_REFERRAL_FAILURE' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_points((SELECT points_awarded=false FROM public.referral_uses WHERE id='fc140000-0000-4000-8000-000000000001')
 AND NOT EXISTS(SELECT 1 FROM public.user_points WHERE user_id='fc110000-0000-4000-8000-000000000004'),'partial referral rolls back both credits and claim');
END $$;
RESET ROLE;
DROP TRIGGER synthetic_referral_failure ON public.user_points;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_points((SELECT replayed=true FROM public.complete_booking_with_points_atomic('fc110000-0000-4000-8000-000000000001','fc130000-0000-4000-8000-000000000003','confirmed')),'completed API recovery remains reachable after bonus failure');
SELECT pg_temp.assert_points(public.award_referral_points_atomic('fc110000-0000-4000-8000-000000000002'),'referral recovers');
SELECT pg_temp.assert_points(NOT public.award_referral_points_atomic('fc110000-0000-4000-8000-000000000002'),'referral replay no second credits');
DO $$ DECLARE sig text; role_name text; BEGIN
 FOREACH sig IN ARRAY ARRAY['public.complete_booking_with_points_atomic(uuid,uuid,text)',
  'public.cancel_booking_with_points_atomic(uuid,uuid,text)','public.checkout_booking_with_points_atomic(uuid,uuid,text,timestamptz,jsonb,int,boolean)',
  'public.award_referral_points_atomic(uuid)','public.booking_point_legacy_issues()'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF has_function_privilege(role_name,sig,'EXECUTE') THEN RAISE EXCEPTION 'public point mutation exposed'; END IF;
  END LOOP;
 END LOOP;
END $$;
RESET ROLE;
DELETE FROM public.bookings WHERE id='fc130000-0000-4000-8000-000000000004';
DELETE FROM auth.users WHERE id='fc110000-0000-4000-8000-000000000002';
SELECT pg_temp.assert_points(NOT EXISTS(SELECT 1 FROM public.user_points WHERE user_id='fc110000-0000-4000-8000-000000000002'),'account erasure retains existing cascade semantics');
ROLLBACK;
