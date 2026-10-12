-- Disposable automatic-flag, detection context and moderation contracts.
BEGIN;
DO $$ BEGIN IF current_database()<>'carelink_shadow' THEN RAISE EXCEPTION 'disposable shadow required';END IF;END $$;
CREATE FUNCTION pg_temp.assert_flags(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'flag fixture: %',label;END IF;END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('fa140000-0000-4000-8000-000000000001','synthetic-flags@example.invalid',now());
UPDATE public.profiles SET is_platform_admin=true WHERE id='fa140000-0000-4000-8000-000000000001';
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
 SELECT ('fa140001-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic flag facility','synthetic-flag-'||n,'その他','合成県','合成市','合成住所','draft' FROM generate_series(1,7) n;
SET LOCAL ROLE service_role;
INSERT INTO public.facility_reviews(id,facility_id,user_id,reviewer_name,reviewer_ip,rating,comment,status,rating_skill,rating_service,rating_atmosphere,rating_cleanliness,rating_explanation)
 SELECT ('fa140002-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('fa140001-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fa140000-0000-4000-8000-000000000001','Synthetic author','192.0.2.14',4,'Synthetic unreviewed body','published',4,4,4,4,4 FROM generate_series(1,3) n;
INSERT INTO public.moderation_queue(content_type,content_id,facility_id,reporter_id,report_reason,auto_flags,status)
 VALUES('review','fa140002-0000-4000-8000-000000000001','fa140001-0000-4000-8000-000000000001','fa140000-0000-4000-8000-000000000001','Original human report','["user_report"]','pending');
DO $$ DECLARE input jsonb; qid uuid; snap jsonb; h text; BEGIN
 SELECT jsonb_agg(jsonb_build_object('id',v.id,'facility_id',v.facility_id)) INTO input FROM public.facility_reviews v WHERE v.reviewer_ip='192.0.2.14';
 SELECT id INTO qid FROM public.moderation_queue WHERE content_id='fa140002-0000-4000-8000-000000000001';
 SELECT snapshot INTO snap FROM public.moderation_review_snapshot('fa140000-0000-4000-8000-000000000001',qid);h:=snap->>'content_hash';
 PERFORM pg_temp.assert_flags((SELECT count(*)=3 FROM public.flag_review_group_atomic(input,'bulk_submission')),'3 flags confirmed');
 PERFORM pg_temp.assert_flags((SELECT count(*)=3 FROM public.moderation_queue WHERE status='pending' AND content_id IN(SELECT id FROM public.facility_reviews WHERE reviewer_ip='192.0.2.14')),'each flag has one pending queue');
 PERFORM pg_temp.assert_flags((SELECT report_reason='Original human report' AND reporter_id='fa140000-0000-4000-8000-000000000001' AND auto_flags @> '["user_report","bulk_submission"]'::jsonb FROM public.moderation_queue WHERE id=qid),'human report and prior flags retained');
 BEGIN PERFORM public.moderate_review_content_atomic('fa140000-0000-4000-8000-000000000001',qid,'pending','approved',p_expected_content_hash=>h);RAISE EXCEPTION 'old detection context approved';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'MODERATION_CONTENT_CHANGED' THEN RAISE;END IF;END;
 SELECT snapshot INTO snap FROM public.moderation_review_snapshot('fa140000-0000-4000-8000-000000000001',qid);h:=snap->>'content_hash';
 PERFORM pg_temp.assert_flags(snap->>'report_reason'='Original human report' AND snap#>>'{review,flag_reason}' LIKE 'bulk_submission: 3%','snapshot displays report and current detection');
 PERFORM public.moderate_review_content_atomic('fa140000-0000-4000-8000-000000000001',qid,'pending','approved',p_expected_content_hash=>h);
 PERFORM pg_temp.assert_flags((SELECT count(*)=0 FROM public.flag_review_group_atomic(input,'bulk_submission')),'same approved evidence is not reflagged');
 PERFORM pg_temp.assert_flags((SELECT is_flagged IS FALSE FROM public.facility_reviews WHERE id='fa140002-0000-4000-8000-000000000001'),'approval stays released');
END $$;
INSERT INTO public.facility_reviews(id,facility_id,reviewer_name,reviewer_ip,rating,comment,status,rating_skill,rating_service,rating_atmosphere,rating_cleanliness,rating_explanation)
 VALUES('fa140002-0000-4000-8000-000000000004','fa140001-0000-4000-8000-000000000004','Synthetic new evidence','192.0.2.14',4,'Synthetic fourth body','published',4,4,4,4,4);
DO $$ DECLARE input jsonb; BEGIN
 SELECT jsonb_agg(jsonb_build_object('id',v.id,'facility_id',v.facility_id)) INTO input FROM public.facility_reviews v WHERE v.reviewer_ip='192.0.2.14';
 PERFORM pg_temp.assert_flags((SELECT count(*)=2 FROM public.flag_review_group_atomic(input,'bulk_submission')),'new group evidence flags new and previously approved candidates');
 PERFORM pg_temp.assert_flags((SELECT count(*)=4 FROM public.moderation_queue WHERE status='pending' AND content_id IN(SELECT id FROM public.facility_reviews WHERE reviewer_ip='192.0.2.14')),'one pending per current flagged review');
END $$;
-- Duplicate-facility rules also cover historical visits beyond the 24h guard.
INSERT INTO public.facility_reviews(id,facility_id,reviewer_name,reviewer_ip,rating,created_at,status)
 SELECT ('fa140002-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fa140001-0000-4000-8000-000000000005','Synthetic old visit','2001:db8::14',4,now()-interval '3 days','published' FROM generate_series(5,6) n;
DO $$ DECLARE input jsonb; BEGIN
 SELECT jsonb_agg(jsonb_build_object('id',v.id,'facility_id',v.facility_id)) INTO input FROM public.facility_reviews v WHERE v.reviewer_ip='2001:db8::14';
 PERFORM pg_temp.assert_flags((SELECT count(*)=2 FROM public.flag_review_group_atomic(input,'duplicate_facility')),'historical duplicate facility group flagged');
END $$;
RESET ROLE;
CREATE FUNCTION pg_temp.fail_flag_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reviewer_ip='192.0.2.15' AND NEW.is_flagged IS TRUE THEN RAISE EXCEPTION 'SYNTHETIC_FLAG_FAILURE';END IF;RETURN NEW;END $$;
CREATE TRIGGER synthetic_flag_failure BEFORE UPDATE ON public.facility_reviews FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_flag_update();
SET LOCAL ROLE service_role;
INSERT INTO public.facility_reviews(id,facility_id,reviewer_name,reviewer_ip,rating,status)
 SELECT ('fa140003-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('fa140001-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic rollback','192.0.2.15',4,'published' FROM generate_series(1,3) n;
DO $$ DECLARE input jsonb; BEGIN
 SELECT jsonb_agg(jsonb_build_object('id',v.id,'facility_id',v.facility_id)) INTO input FROM public.facility_reviews v WHERE v.reviewer_ip='192.0.2.15';
 BEGIN PERFORM public.flag_review_group_atomic(input,'bulk_submission');RAISE EXCEPTION 'failed flag accepted';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_FLAG_FAILURE' THEN RAISE;END IF;END;
 PERFORM pg_temp.assert_flags(NOT EXISTS(SELECT 1 FROM public.moderation_queue WHERE content_id IN(SELECT id FROM public.facility_reviews WHERE reviewer_ip='192.0.2.15')),'failed flag rolls back queues');
 PERFORM pg_temp.assert_flags(NOT EXISTS(SELECT 1 FROM public.facility_reviews WHERE reviewer_ip='192.0.2.15' AND is_flagged),'failed flag rolls back flags');
END $$;
SELECT pg_temp.assert_flags(NOT has_function_privilege('anon','public.flag_review_group_atomic(jsonb,text)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.flag_review_group_atomic(jsonb,text)','EXECUTE'),'automatic flag RPC is service only');
ROLLBACK;
