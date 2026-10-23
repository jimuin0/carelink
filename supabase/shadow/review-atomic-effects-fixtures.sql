-- Disposable, synthetic namespace only. Every write is rolled back.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'shadow DB required'; END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'fa120000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_review(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'review fixture: %',label; END IF; END $$;
SELECT pg_temp.assert_review(NOT has_table_privilege('authenticated','public.referral_codes','INSERT')
  AND NOT has_table_privilege('anon','public.referral_codes','INSERT'),'direct referral issuance denied');
SELECT pg_temp.assert_review(NOT has_column_privilege('authenticated','public.facility_reviews','comment','UPDATE')
  AND NOT has_table_privilege('authenticated','public.facility_reviews','INSERT')
  AND has_column_privilege('authenticated','public.facility_reviews','status','UPDATE'),'content is server-only; owner visibility preserved');
SELECT pg_temp.assert_review(NOT has_function_privilege('anon','public.edit_review_atomic(uuid,uuid,jsonb)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.edit_review_atomic(uuid,uuid,jsonb)','EXECUTE')
  AND has_function_privilege('service_role','public.edit_review_atomic(uuid,uuid,jsonb)','EXECUTE'),'edit RPC server-only');
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('fa120000-0000-4000-8000-000000000001','review-visit@example.invalid',now()),
 ('fa120000-0000-4000-8000-000000000002','review-no-visit@example.invalid',now()),
 ('fa120000-0000-4000-8000-000000000003','review-failure@example.invalid',now());
UPDATE public.profiles SET is_platform_admin=true WHERE id='fa120000-0000-4000-8000-000000000002';
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES
 ('fa120001-0000-4000-8000-000000000001','Synthetic review','synthetic-review-atomic','その他','検証県','検証市','検証住所','draft');
SET LOCAL ROLE service_role;
INSERT INTO public.bookings(facility_id,user_id,booking_date,start_time,end_time,customer_name,status,total_price,points_used) VALUES
 ('fa120001-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000000001','2030-01-07','10:00','11:00','Synthetic','completed',1000,0),
 ('fa120001-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000000003','2030-01-07','11:00','12:00','Synthetic','completed',1000,0);
INSERT INTO public.facility_reviews(id,facility_id,user_id,reviewer_name,rating,comment,reviewer_ip,is_verified_visit,is_flagged,flag_reason) VALUES
 ('fa120002-0000-4000-8000-000000000001','fa120001-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000000001','Synthetic',4,'Initial flagged','192.0.2.1',false,true,'Initial reason');
SELECT pg_temp.assert_review((SELECT is_verified_visit FROM public.facility_reviews WHERE id='fa120002-0000-4000-8000-000000000001'),'DB verifies visit, ignoring false input');
SELECT pg_temp.assert_review((SELECT count(*)=1 AND sum(points)=50 FROM public.user_points WHERE user_id='fa120000-0000-4000-8000-000000000001' AND reason LIKE '口コミポイント:%'),'first credit exactly 50');
SELECT pg_temp.assert_review((SELECT count(*)=1 FROM public.moderation_queue WHERE content_id='fa120002-0000-4000-8000-000000000001' AND status='pending'),'flag and queue commit together');
-- The same account may review the same facility once per 24h (20261023120000),
-- so the repeat review is dated outside that window.
INSERT INTO public.facility_reviews(facility_id,user_id,reviewer_name,rating,reviewer_ip,is_verified_visit,created_at) VALUES
 ('fa120001-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000000001','Second synthetic',4,'192.0.2.2',true,clock_timestamp()-interval '25 hours');
INSERT INTO public.facility_reviews(facility_id,user_id,reviewer_name,rating,reviewer_ip,is_verified_visit) VALUES
 ('fa120001-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000000002','No visit',4,'192.0.2.3',true),
 ('fa120001-0000-4000-8000-000000000001',NULL,'Anonymous',4,'192.0.2.4',false);
SELECT pg_temp.assert_review((SELECT count(*)=1 FROM public.user_points WHERE user_id='fa120000-0000-4000-8000-000000000001' AND reason LIKE '口コミポイント:%'),'repeat review never duplicates points');
SELECT pg_temp.assert_review(NOT EXISTS(SELECT 1 FROM public.user_points WHERE user_id='fa120000-0000-4000-8000-000000000002'),'unverified input cannot earn points');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.facility_reviews(facility_id,reviewer_name,rating,reviewer_ip)
      VALUES('fa120001-0000-4000-8000-000000000001','Duplicate',4,'192.0.2.1');
    RAISE EXCEPTION 'duplicate accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'REVIEW_RECENT_DUPLICATE' THEN RAISE; END IF; END;
END $$;
SELECT pg_temp.assert_review(NOT EXISTS(SELECT * FROM public.edit_review_atomic('fa120000-0000-4000-8000-000000000002','fa120002-0000-4000-8000-000000000001','{"comment":"Wrong actor"}')),'other owner cannot edit');
SELECT * FROM public.edit_review_atomic('fa120000-0000-4000-8000-000000000001','fa120002-0000-4000-8000-000000000001',
 '{"rating_skill":5,"rating_service":4,"rating_atmosphere":5,"rating_cleanliness":4,"rating_explanation":5,"comment":"Edited flagged","is_flagged":true,"flag_reason":"Edited reason"}');
SELECT pg_temp.assert_review((SELECT rating=5 AND comment='Edited flagged' AND is_flagged FROM public.facility_reviews WHERE id='fa120002-0000-4000-8000-000000000001'),'edit is applied atomically');
SELECT pg_temp.assert_review((SELECT count(*)=1 AND bool_and(report_reason='Edited reason') FROM public.moderation_queue WHERE content_id='fa120002-0000-4000-8000-000000000001' AND status='pending'),'pending review reason updated without duplicate queue');
UPDATE public.moderation_queue SET status='approved' WHERE content_id='fa120002-0000-4000-8000-000000000001';
SELECT * FROM public.edit_review_atomic('fa120000-0000-4000-8000-000000000001','fa120002-0000-4000-8000-000000000001','{"comment":"Changed after decision"}');
SELECT pg_temp.assert_review((SELECT count(*)=1 FROM public.moderation_queue WHERE content_id='fa120002-0000-4000-8000-000000000001' AND status='pending'),'editing flagged reviewed content reopens review');
-- Rejection is not an author edit. Both pending and escalated reports retain
-- their reason, reporter and flags, with no new pending queue created.
DO $$ DECLARE i integer; rid uuid; qid uuid; prior text; BEGIN
  FOR i IN 4..5 LOOP
    rid := ('fa120002-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
    qid := ('fa120003-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
    prior := CASE WHEN i=4 THEN 'pending' ELSE 'escalated' END;
    INSERT INTO public.facility_reviews(id,facility_id,reviewer_name,rating,reviewer_ip) VALUES
      (rid,'fa120001-0000-4000-8000-000000000001','Reported review',4,'192.0.2.'||(10+i));
    INSERT INTO public.moderation_queue(id,content_type,content_id,facility_id,reporter_id,report_reason,auto_flags,status) VALUES
      (qid,'review',rid,'fa120001-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000000002','Original report','["user_report"]',prior);
    PERFORM * FROM public.moderate_review_content_atomic('fa120000-0000-4000-8000-000000000002',qid,prior,'rejected','Synthetic decision',NULL,p_expected_content_hash=>coalesce((SELECT public.moderation_review_context_hash(mq,r) FROM public.moderation_queue mq JOIN public.facility_reviews r ON r.id=mq.content_id WHERE mq.id=qid),repeat('a',64)));
    PERFORM pg_temp.assert_review((SELECT status='rejected' AND reporter_id='fa120000-0000-4000-8000-000000000002'
      AND report_reason='Original report' AND auto_flags='["user_report"]'::jsonb FROM public.moderation_queue WHERE id=qid),'rejection retains original report metadata');
    PERFORM pg_temp.assert_review((SELECT count(*)=1 AND count(*) FILTER(WHERE status='pending')=0 FROM public.moderation_queue WHERE content_type='review' AND content_id=rid),'rejection does not reopen pending review');
  END LOOP;
END $$;
RESET ROLE;
CREATE FUNCTION pg_temp.fail_review_point() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.reason LIKE '口コミポイント:%' THEN RAISE EXCEPTION 'SYNTHETIC_REVIEW_POINT_FAILURE'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_review_point_failure BEFORE INSERT ON public.user_points FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_review_point();
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN
    INSERT INTO public.facility_reviews(id,facility_id,user_id,reviewer_name,rating,reviewer_ip) VALUES
      ('fa120002-0000-4000-8000-000000000002','fa120001-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000000003','Failure',4,'192.0.2.5');
    RAISE EXCEPTION 'point failure accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_REVIEW_POINT_FAILURE' THEN RAISE; END IF; END;
  PERFORM pg_temp.assert_review(NOT EXISTS(SELECT 1 FROM public.facility_reviews WHERE id='fa120002-0000-4000-8000-000000000002'),'point failure rolls back review');
END $$;
RESET ROLE;
DROP TRIGGER synthetic_review_point_failure ON public.user_points;
CREATE FUNCTION pg_temp.fail_review_queue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.content_type='review' THEN RAISE EXCEPTION 'SYNTHETIC_REVIEW_QUEUE_FAILURE'; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_review_queue_failure BEFORE INSERT OR UPDATE ON public.moderation_queue FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_review_queue();
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN
    INSERT INTO public.facility_reviews(id,facility_id,user_id,reviewer_name,rating,reviewer_ip,is_flagged) VALUES
      ('fa120002-0000-4000-8000-000000000003','fa120001-0000-4000-8000-000000000001','fa120000-0000-4000-8000-000000000003','Queue failure',4,'192.0.2.6',true);
    RAISE EXCEPTION 'queue failure accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_REVIEW_QUEUE_FAILURE' THEN RAISE; END IF; END;
  PERFORM pg_temp.assert_review(NOT EXISTS(SELECT 1 FROM public.facility_reviews WHERE id='fa120002-0000-4000-8000-000000000003')
    AND NOT EXISTS(SELECT 1 FROM public.user_points WHERE user_id='fa120000-0000-4000-8000-000000000003' AND reason LIKE '口コミポイント:%'),'queue failure rolls back review AND points');
  BEGIN
    PERFORM * FROM public.edit_review_atomic('fa120000-0000-4000-8000-000000000001','fa120002-0000-4000-8000-000000000001','{"comment":"Must roll back"}');
    RAISE EXCEPTION 'edit queue failure accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_REVIEW_QUEUE_FAILURE' THEN RAISE; END IF; END;
  PERFORM pg_temp.assert_review((SELECT comment='Changed after decision' FROM public.facility_reviews WHERE id='fa120002-0000-4000-8000-000000000001'),'queue failure rolls back edit');
END $$;
ROLLBACK;
