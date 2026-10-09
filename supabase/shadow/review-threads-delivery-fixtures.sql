-- Dedicated PG17 / synthetic fixtures only. No provider or physical object calls.
BEGIN;
CREATE FUNCTION pg_temp.assert_thread(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'threads fixture failed: %',label; END IF; END $$;
SELECT pg_temp.assert_thread(current_setting('server_version_num')::int BETWEEN 170000 AND 179999,'PG17');
SELECT pg_temp.assert_thread(current_database() LIKE 'carelink_shadow%' OR
 (current_database()='postgres' AND current_setting('application_name')='carelink-batch2-photos'),'isolated target');
SELECT pg_temp.assert_thread(NOT EXISTS(SELECT 1 FROM public.platform_blog_posts WHERE id::text LIKE 'ef12%'),'synthetic namespace unused');
INSERT INTO public.platform_blog_posts(id,slug,title,is_published) VALUES
 ('ef120000-0000-4000-8000-000000000001','synthetic-threads-start','Frozen title',true),
 ('ef120000-0000-4000-8000-000000000002','synthetic-threads-late','Late attempt',true),
 ('ef120000-0000-4000-8000-000000000003','synthetic-threads-legacy','Legacy unknown',true),
 ('ef120000-0000-4000-8000-000000000004','synthetic-threads-permanent','Permanent pre-publication',true);
SELECT pg_temp.assert_thread(NOT has_function_privilege('authenticated','public.claim_threads_article(uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.start_threads_article_publish(uuid,uuid,text)','EXECUTE')
 AND has_function_privilege('service_role','public.finish_threads_article_publish(uuid,uuid,text,text)','EXECUTE'),'RPC service-only');
SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN PERFORM public.claim_threads_article('ef120000-0000-4000-8000-000000000001');
 RAISE EXCEPTION 'unprivileged RPC accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN BEGIN UPDATE public.platform_blog_posts SET threads_posted_at=now() WHERE id='ef120000-0000-4000-8000-000000000001';
 RAISE EXCEPTION 'old consumer claim accepted'; EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'THREADS_CONSUMER_RELOAD_REQUIRED' THEN RAISE; END IF; END; END $$;
SELECT set_config('carelink.threads_fixture.attempt1',(public.claim_threads_article('ef120000-0000-4000-8000-000000000001')->>'attemptId'),true);
SELECT pg_temp.assert_thread(public.claim_threads_article('ef120000-0000-4000-8000-000000000001') IS NULL,'second claimant blocked');
SELECT pg_temp.assert_thread(public.start_threads_article_publish('ef120000-0000-4000-8000-000000000001',current_setting('carelink.threads_fixture.attempt1')::uuid,'123'),'start persisted');
RESET ROLE;
CREATE FUNCTION pg_temp.reject_thread_finalize() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.id='ef120000-0000-4000-8000-000000000001' AND NEW.threads_post_status='published'
  AND current_setting('carelink.threads_fixture.fail_finalize',true)='yes' THEN RAISE EXCEPTION 'SYNTHETIC_THREADS_FINALIZE_FAILURE'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER synthetic_threads_finalize_failure BEFORE UPDATE ON public.platform_blog_posts FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_thread_finalize();
SELECT set_config('carelink.threads_fixture.fail_finalize','yes',true);
SET LOCAL ROLE service_role;
DO $$ BEGIN BEGIN PERFORM public.finish_threads_article_publish('ef120000-0000-4000-8000-000000000001',current_setting('carelink.threads_fixture.attempt1')::uuid,'published','456');
 RAISE EXCEPTION 'failed finalize accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SYNTHETIC_THREADS_FINALIZE_FAILURE' THEN RAISE; END IF; END; END $$;
RESET ROLE;
SELECT pg_temp.assert_thread((SELECT threads_post_status='started' AND threads_creation_id='123' AND threads_delivery_started_at IS NOT NULL AND threads_post_id IS NULL
 FROM public.platform_blog_posts WHERE id='ef120000-0000-4000-8000-000000000001'),'finalize rollback preserves start fence');
UPDATE public.platform_blog_posts SET threads_posted_at='2000-01-01' WHERE id='ef120000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_thread(public.claim_threads_article('ef120000-0000-4000-8000-000000000001') IS NULL,'started fence never expires');
SELECT pg_temp.assert_thread(public.finish_threads_article_publish('ef120000-0000-4000-8000-000000000001',current_setting('carelink.threads_fixture.attempt1')::uuid,'transient',NULL)='ambiguous','started transient cannot release');
SELECT pg_temp.assert_thread(NOT public.reconcile_threads_article_publish('ef120000-0000-4000-8000-000000000001',current_setting('carelink.threads_fixture.attempt1')::uuid,'123','FINISHED'),'FINISHED does not mean public');
RESET ROLE;
SELECT set_config('carelink.threads_fixture.fail_finalize','no',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_thread(public.reconcile_threads_article_publish('ef120000-0000-4000-8000-000000000001',current_setting('carelink.threads_fixture.attempt1')::uuid,'123','PUBLISHED'),'PUBLISHED proof reconciles');
SELECT pg_temp.assert_thread(public.claim_threads_article('ef120000-0000-4000-8000-000000000001') IS NULL,'reconciled null public ID never republishes');
RESET ROLE;
SELECT pg_temp.assert_thread((SELECT threads_post_status='published' AND threads_post_id IS NULL AND threads_creation_id='123'
 FROM public.platform_blog_posts WHERE id='ef120000-0000-4000-8000-000000000001'),'creation ID never masquerades as public post ID');
SELECT set_config('carelink.threads_fixture.old_attempt',(public.claim_threads_article('ef120000-0000-4000-8000-000000000002')->>'attemptId'),true);
UPDATE public.platform_blog_posts SET threads_posted_at='2000-01-01' WHERE id='ef120000-0000-4000-8000-000000000002';
SELECT set_config('carelink.threads_fixture.new_attempt',(public.claim_threads_article('ef120000-0000-4000-8000-000000000002')->>'attemptId'),true);
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_thread(NOT public.start_threads_article_publish('ef120000-0000-4000-8000-000000000002',current_setting('carelink.threads_fixture.old_attempt')::uuid,'777'),'late reclaimed nonce cannot publish');
SELECT pg_temp.assert_thread(public.finish_threads_article_publish('ef120000-0000-4000-8000-000000000002',current_setting('carelink.threads_fixture.old_attempt')::uuid,'published','888')='conflict','late finalize cannot overwrite newer attempt');
SELECT pg_temp.assert_thread(public.start_threads_article_publish('ef120000-0000-4000-8000-000000000002',current_setting('carelink.threads_fixture.new_attempt')::uuid,'999'),'new nonce may start');
SELECT pg_temp.assert_thread(public.finish_threads_article_publish('ef120000-0000-4000-8000-000000000002',current_setting('carelink.threads_fixture.new_attempt')::uuid,'published','111')='published','verified public ID saved');
SELECT pg_temp.assert_thread(public.finish_threads_article_publish('ef120000-0000-4000-8000-000000000002',current_setting('carelink.threads_fixture.new_attempt')::uuid,'published','111')='published','same finalize replay');
RESET ROLE;
UPDATE public.platform_blog_posts SET threads_posted_at='2000-01-01' WHERE id='ef120000-0000-4000-8000-000000000003';
SELECT pg_temp.assert_thread(public.claim_threads_article('ef120000-0000-4000-8000-000000000003') IS NULL,'legacy old claim stays unknown');
SELECT set_config('carelink.threads_fixture.permanent',(public.claim_threads_article('ef120000-0000-4000-8000-000000000004')->>'attemptId'),true);
SELECT pg_temp.assert_thread(public.finish_threads_article_publish('ef120000-0000-4000-8000-000000000004',current_setting('carelink.threads_fixture.permanent')::uuid,'permanent',NULL)='permanent','prepublication permanent retained');
SELECT pg_temp.assert_thread(public.claim_threads_article('ef120000-0000-4000-8000-000000000004') IS NULL,'permanent cooldown');
UPDATE public.platform_blog_posts SET threads_posted_at='2000-01-01' WHERE id='ef120000-0000-4000-8000-000000000004';
SELECT pg_temp.assert_thread(public.claim_threads_article('ef120000-0000-4000-8000-000000000004') IS NOT NULL,'known prepublication failure may retry after cooldown');
SELECT 'threads delivery/start/nonce/rollback/reconciliation checks passed';

-- Synthetic object metadata only; no Storage provider upload/delete is called.
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('ef130000-0000-4000-8000-000000000001','review-fixture-a@example.invalid',now()),
 ('ef130000-0000-4000-8000-000000000002','review-fixture-b@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES
 ('ef140000-0000-4000-8000-000000000001','Review fixture A','review-fixture-a','その他','検証県','検証市','検証住所','published'),
 ('ef140000-0000-4000-8000-000000000002','Review fixture B','review-fixture-b','その他','検証県','検証市','検証住所','published');
UPDATE storage.buckets SET public=true WHERE id='review-photos';
INSERT INTO storage.objects(id,bucket_id,name,owner_id,metadata) VALUES
 ('ef150000-0000-4000-8000-000000000001','review-photos','reviews/ef140000-0000-4000-8000-000000000001/owned.png','ef130000-0000-4000-8000-000000000001','{"size":4,"mimetype":"image/png"}'),
 ('ef150000-0000-4000-8000-000000000002','review-photos','reviews/ef140000-0000-4000-8000-000000000001/other.png','ef130000-0000-4000-8000-000000000002','{"size":4,"mimetype":"image/png"}'),
 ('ef150000-0000-4000-8000-000000000003','review-photos','reviews/ef140000-0000-4000-8000-000000000001/unknown.png','ef130000-0000-4000-8000-000000000001',NULL);
SELECT pg_temp.assert_thread((SELECT count(*)=1 FROM public.owned_review_photo_metadata('ef130000-0000-4000-8000-000000000001','ef140000-0000-4000-8000-000000000001','reviews/ef140000-0000-4000-8000-000000000001/owned.png')),'live own object metadata');
SELECT pg_temp.assert_thread((SELECT count(*)=0 FROM public.owned_review_photo_metadata('ef130000-0000-4000-8000-000000000001','ef140000-0000-4000-8000-000000000001','reviews/ef140000-0000-4000-8000-000000000001/other.png')),'other owner is not attachment authority');
DO $$ DECLARE item text; BEGIN FOREACH item IN ARRAY ARRAY['other.png','unknown.png'] LOOP
 BEGIN INSERT INTO public.facility_reviews(facility_id,user_id,reviewer_name,rating,reviewer_ip,photo_urls)
 VALUES('ef140000-0000-4000-8000-000000000001','ef130000-0000-4000-8000-000000000001','Synthetic rejected',5,'192.0.2.31',
 ARRAY['https://test.supabase.co/storage/v1/object/public/review-photos/reviews/ef140000-0000-4000-8000-000000000001/'||item]);
 RAISE EXCEPTION 'invalid photo attachment accepted'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'REVIEW_PHOTO_OBJECT_UNVERIFIED' THEN RAISE; END IF; END; END LOOP; END $$;
DO $$ BEGIN BEGIN INSERT INTO public.facility_reviews(facility_id,user_id,reviewer_name,rating,reviewer_ip,photo_urls)
 VALUES('ef140000-0000-4000-8000-000000000002','ef130000-0000-4000-8000-000000000001','Synthetic wrong facility',5,'192.0.2.31',
 ARRAY['https://test.supabase.co/storage/v1/object/public/review-photos/reviews/ef140000-0000-4000-8000-000000000001/owned.png']);
 RAISE EXCEPTION 'cross facility attachment accepted'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'REVIEW_PHOTO_FACILITY_UNVERIFIED' THEN RAISE; END IF; END; END $$;
INSERT INTO public.facility_reviews(id,facility_id,user_id,reviewer_name,rating,reviewer_ip,photo_urls)
 VALUES('ef160000-0000-4000-8000-000000000001','ef140000-0000-4000-8000-000000000001','ef130000-0000-4000-8000-000000000001','Synthetic valid',5,'192.0.2.31',
 ARRAY['https://test.supabase.co/storage/v1/object/public/review-photos/reviews/ef140000-0000-4000-8000-000000000001/owned.png']);
SELECT pg_temp.assert_thread((SELECT count(*)=1 FROM public.review_photo_references WHERE review_id='ef160000-0000-4000-8000-000000000001' AND object_id='ef150000-0000-4000-8000-000000000001'),'review and object reference commit together');
-- Invoke the delete guard against an isolated temporary object shape. The
-- managed Storage protect_delete guard is never bypassed or disabled.
CREATE TEMP TABLE synthetic_storage_delete (LIKE storage.objects INCLUDING DEFAULTS);
CREATE TRIGGER synthetic_referenced_delete BEFORE DELETE ON synthetic_storage_delete FOR EACH ROW EXECUTE FUNCTION public.guard_referenced_review_object_delete();
INSERT INTO synthetic_storage_delete(id,bucket_id,name,owner_id) VALUES
 ('ef150000-0000-4000-8000-000000000001','review-photos','reviews/ef140000-0000-4000-8000-000000000001/owned.png','ef130000-0000-4000-8000-000000000001');
DO $$ BEGIN BEGIN DELETE FROM synthetic_storage_delete; RAISE EXCEPTION 'referenced object guard failed';
 EXCEPTION WHEN check_violation THEN IF SQLERRM<>'REVIEW_PHOTO_STILL_REFERENCED' THEN RAISE; END IF; END; END $$;
DELETE FROM auth.users WHERE id='ef130000-0000-4000-8000-000000000001';
SELECT pg_temp.assert_thread((SELECT user_id IS NULL FROM public.facility_reviews WHERE id='ef160000-0000-4000-8000-000000000001')
 AND EXISTS(SELECT 1 FROM public.review_photo_references WHERE object_id='ef150000-0000-4000-8000-000000000001'),'retirement retains review/reference, detaches actor without blocking Auth deletion');
SELECT 'review owner/facility/null metadata/reference/retirement checks passed';

ROLLBACK;
