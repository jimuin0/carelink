-- Disposable review content/snapshot contracts. No real users or provider sends.
BEGIN;
DO $$ BEGIN IF current_database()<>'carelink_shadow' THEN RAISE EXCEPTION 'disposable shadow required'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_review_cas(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'review CAS fixture: %',label; END IF; END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('fa130000-0000-4000-8000-000000000001','synthetic-review-cas@example.invalid',now());
UPDATE public.profiles SET is_platform_admin=true WHERE id='fa130000-0000-4000-8000-000000000001';
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
 VALUES('fa130001-0000-4000-8000-000000000001','Synthetic CAS facility','synthetic-review-cas','その他','合成県','合成市','合成住所','draft');
SET LOCAL ROLE service_role;
INSERT INTO public.facility_reviews(id,facility_id,user_id,reviewer_name,rating,comment,is_flagged,flag_reason,status,reviewer_ip,rating_skill,rating_service,rating_atmosphere,rating_cleanliness,rating_explanation)
 VALUES('fa130002-0000-4000-8000-000000000001','fa130001-0000-4000-8000-000000000001','fa130000-0000-4000-8000-000000000001','Synthetic author',4,'Original text',true,'Synthetic flag','published','127.0.0.11',4,4,4,4,4);
SELECT pg_temp.assert_review_cas(NOT has_function_privilege('anon','public.moderation_review_snapshot(uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.moderate_review_content_atomic(uuid,uuid,text,text,text,timestamptz,text)','EXECUTE'),'browser cannot read/administer service snapshots');
DO $$ DECLARE qid uuid; observed jsonb; h text; rev timestamptz; BEGIN
 SELECT id INTO qid FROM public.moderation_queue WHERE content_id='fa130002-0000-4000-8000-000000000001' AND status='pending';
 SELECT snapshot INTO observed FROM public.moderation_review_snapshot('fa130000-0000-4000-8000-000000000001',qid);
 PERFORM pg_temp.assert_review_cas(observed#>>'{review,comment}'='Original text' AND observed->>'content_type'='review','snapshot includes actual author text');
 h:=observed->>'content_hash';
 BEGIN PERFORM public.moderate_content_atomic('fa130000-0000-4000-8000-000000000001',qid,'pending','approved');
  RAISE EXCEPTION 'legacy review decision accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'MODERATION_CONTENT_SNAPSHOT_REQUIRED' THEN RAISE; END IF; END;
 PERFORM public.edit_review_atomic('fa130000-0000-4000-8000-000000000001','fa130002-0000-4000-8000-000000000001','{"comment":"Changed text"}');
 BEGIN PERFORM public.moderate_review_content_atomic('fa130000-0000-4000-8000-000000000001',qid,'pending','approved',p_expected_content_hash=>h);
  RAISE EXCEPTION 'unseen content approved'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'MODERATION_CONTENT_CHANGED' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_review_cas((SELECT status='pending' FROM public.moderation_queue WHERE id=qid),'changed content leaves queue pending');
 PERFORM pg_temp.assert_review_cas((SELECT is_flagged FROM public.facility_reviews WHERE id='fa130002-0000-4000-8000-000000000001'),'changed content is still flagged');
 SELECT snapshot INTO observed FROM public.moderation_review_snapshot('fa130000-0000-4000-8000-000000000001',qid);h:=observed->>'content_hash';
 PERFORM public.moderate_review_content_atomic('fa130000-0000-4000-8000-000000000001',qid,'pending','approved',p_expected_content_hash=>h);
 PERFORM pg_temp.assert_review_cas((SELECT NOT is_flagged AND flag_reason IS NULL AND status='published' FROM public.facility_reviews WHERE id='fa130002-0000-4000-8000-000000000001'),'approval releases flags in same commit');
 PERFORM pg_temp.assert_review_cas((SELECT replayed FROM public.moderate_review_content_atomic('fa130000-0000-4000-8000-000000000001',qid,'pending','approved',p_expected_content_hash=>h)),'exact lost response replays');
 SELECT reviewed_at INTO rev FROM public.moderation_queue WHERE id=qid;
 PERFORM public.moderate_review_content_atomic('fa130000-0000-4000-8000-000000000001',qid,'approved','rejected','Synthetic rejection',rev,h);
 SELECT reviewed_at INTO rev FROM public.moderation_queue WHERE id=qid;
 PERFORM public.moderate_review_content_atomic('fa130000-0000-4000-8000-000000000001',qid,'rejected','approved',NULL,rev,h);
 PERFORM pg_temp.assert_review_cas((SELECT NOT is_flagged AND status='hidden' FROM public.facility_reviews WHERE id='fa130002-0000-4000-8000-000000000001'),'approval never republishes independent hidden status');
 UPDATE public.profiles SET is_platform_admin=false WHERE id='fa130000-0000-4000-8000-000000000001';
 BEGIN PERFORM public.moderation_review_snapshot('fa130000-0000-4000-8000-000000000001',qid);RAISE EXCEPTION 'revoked snapshot accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'MODERATION_PERMISSION_REVOKED' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
UPDATE public.profiles SET is_platform_admin=true WHERE id='fa130000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
INSERT INTO public.facility_reviews(id,facility_id,reviewer_name,rating,comment,is_flagged,flag_reason,status,reviewer_ip,rating_skill,rating_service,rating_atmosphere,rating_cleanliness,rating_explanation)
 VALUES('fa130002-0000-4000-8000-000000000002','fa130001-0000-4000-8000-000000000001','Synthetic rollback',4,'Rollback text',true,'Synthetic flag','published','127.0.0.12',4,4,4,4,4);
RESET ROLE;
CREATE FUNCTION pg_temp.fail_review_cas() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='approved' THEN RAISE EXCEPTION 'SYNTHETIC_DECISION_WRITE_FAILURE'; END IF;RETURN NEW;END $$;
CREATE TRIGGER synthetic_review_cas_failure BEFORE UPDATE ON public.moderation_queue FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_review_cas();
SET LOCAL ROLE service_role;
DO $$ DECLARE qid uuid; h text; BEGIN
 SELECT id INTO qid FROM public.moderation_queue WHERE content_id='fa130002-0000-4000-8000-000000000002';
 SELECT public.review_content_hash(r) INTO h FROM public.facility_reviews r WHERE r.id='fa130002-0000-4000-8000-000000000002';
 BEGIN PERFORM public.moderate_review_content_atomic('fa130000-0000-4000-8000-000000000001',qid,'pending','approved',p_expected_content_hash=>h);RAISE EXCEPTION 'failed queue write accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_DECISION_WRITE_FAILURE' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_review_cas((SELECT is_flagged FROM public.facility_reviews WHERE id='fa130002-0000-4000-8000-000000000002'),'failed decision rolls back flag release');
 PERFORM pg_temp.assert_review_cas((SELECT status='pending' FROM public.moderation_queue WHERE id=qid),'failed decision keeps pending queue');
END $$;
ROLLBACK;
