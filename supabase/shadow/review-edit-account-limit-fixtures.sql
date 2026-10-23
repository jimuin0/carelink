-- Disposable, synthetic namespace only. Every write is rolled back.
-- Proves migration 20261023120000 on a real PG17 schema:
--   1. the 24h limit counts the account (user_id) as well as the IP;
--   2. a star-only edit keeps the stored moderation decision (approved stays
--      public and counted), while a text edit still re-flags and re-queues;
--   3. client_operation_id is unique, so a resend can never store a second review.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'shadow DB required'; END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'fa910000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_limit(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'review edit/limit fixture: %',label; END IF; END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('fa910000-0000-4000-8000-000000000001','review-limit-member@example.invalid',now()),
 ('fa910000-0000-4000-8000-000000000002','review-limit-moderator@example.invalid',now()),
 ('fa910000-0000-4000-8000-000000000003','review-limit-editor@example.invalid',now());
UPDATE public.profiles SET is_platform_admin=true WHERE id='fa910000-0000-4000-8000-000000000002';
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES
 ('fa910001-0000-4000-8000-000000000001','Synthetic limit A','synthetic-review-limit-a','その他','検証県','検証市','検証住所','published'),
 ('fa910001-0000-4000-8000-000000000002','Synthetic limit B','synthetic-review-limit-b','その他','検証県','検証市','検証住所','published'),
 ('fa910001-0000-4000-8000-000000000003','Synthetic edit C','synthetic-review-edit-c','その他','検証県','検証市','検証住所','published');
SET LOCAL ROLE service_role;

-- 1. Account limit. Before: only reviewer_ip was compared, so the same member
--    on another network was accepted.
INSERT INTO public.facility_reviews(id,facility_id,user_id,reviewer_name,rating,comment,reviewer_ip) VALUES
 ('fa910002-0000-4000-8000-000000000001','fa910001-0000-4000-8000-000000000001','fa910000-0000-4000-8000-000000000001','Synthetic member',5,'First visit','192.0.2.201');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.facility_reviews(facility_id,user_id,reviewer_name,rating,reviewer_ip)
      VALUES('fa910001-0000-4000-8000-000000000001','fa910000-0000-4000-8000-000000000001','Same member, other network',5,'198.51.100.201');
    RAISE EXCEPTION 'same account accepted twice within 24h';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'REVIEW_RECENT_DUPLICATE' THEN RAISE; END IF; END;
END $$;
SELECT pg_temp.assert_limit((SELECT count(*)=1 FROM public.facility_reviews WHERE facility_id='fa910001-0000-4000-8000-000000000001'
  AND user_id='fa910000-0000-4000-8000-000000000001'),'second review by the same account is rolled back');
INSERT INTO public.facility_reviews(facility_id,user_id,reviewer_name,rating,reviewer_ip) VALUES
 ('fa910001-0000-4000-8000-000000000002','fa910000-0000-4000-8000-000000000001','Same member, other facility',4,'198.51.100.202');
INSERT INTO public.facility_reviews(facility_id,reviewer_name,rating,reviewer_ip) VALUES
 ('fa910001-0000-4000-8000-000000000001','Guest on a new network',4,'198.51.100.203');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.facility_reviews(facility_id,reviewer_name,rating,reviewer_ip)
      VALUES('fa910001-0000-4000-8000-000000000001','Guest again',4,'198.51.100.203');
    RAISE EXCEPTION 'guest IP limit lost';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'REVIEW_RECENT_DUPLICATE' THEN RAISE; END IF; END;
END $$;
UPDATE public.facility_reviews SET created_at=clock_timestamp()-interval '25 hours' WHERE id='fa910002-0000-4000-8000-000000000001';
INSERT INTO public.facility_reviews(facility_id,user_id,reviewer_name,rating,reviewer_ip) VALUES
 ('fa910001-0000-4000-8000-000000000001','fa910000-0000-4000-8000-000000000001','Member after 24h',4,'198.51.100.204');
SELECT pg_temp.assert_limit((SELECT count(*)=2 FROM public.facility_reviews WHERE facility_id='fa910001-0000-4000-8000-000000000001'
  AND user_id='fa910000-0000-4000-8000-000000000001'),'the account may review again after 24h');

-- 3. One operation id, one review. The second insert uses another facility,
--    network and no account, so only the unique index can stop it.
INSERT INTO public.facility_reviews(id,facility_id,reviewer_name,rating,reviewer_ip,client_operation_id) VALUES
 ('fa910002-0000-4000-8000-000000000003','fa910001-0000-4000-8000-000000000002','Operation first',4,'198.51.100.210','fa910009-0000-4000-8000-000000000001');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.facility_reviews(facility_id,reviewer_name,rating,reviewer_ip,client_operation_id)
      VALUES('fa910001-0000-4000-8000-000000000003','Operation resend',4,'198.51.100.211','fa910009-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'operation id stored twice';
  EXCEPTION WHEN unique_violation THEN IF SQLERRM NOT LIKE '%uq_facility_reviews_client_operation%' THEN RAISE; END IF; END;
END $$;
SELECT pg_temp.assert_limit((SELECT count(*)=1 FROM public.facility_reviews WHERE client_operation_id='fa910009-0000-4000-8000-000000000001'),'operation id maps to exactly one review');
INSERT INTO public.facility_reviews(facility_id,reviewer_name,rating,reviewer_ip) VALUES
 ('fa910001-0000-4000-8000-000000000002','Legacy form without operation',4,'198.51.100.212'),
 ('fa910001-0000-4000-8000-000000000002','Another legacy form',4,'198.51.100.213');
SELECT pg_temp.assert_limit((SELECT count(*)=2 FROM public.facility_reviews WHERE reviewer_ip IN ('198.51.100.212','198.51.100.213')
  AND client_operation_id IS NULL),'NULL operation ids never collide');
SELECT pg_temp.assert_limit(NOT EXISTS(SELECT 1 FROM public.facility_reviews WHERE facility_id='fa910001-0000-4000-8000-000000000003'),'rejected resend left nothing behind');

-- 2. Star-only edit of an approved review. Before: the API's banned-term flag
--    was applied even though the text was unchanged, the review left
--    public_reviews and the rating, and no pending moderation was created.
INSERT INTO public.facility_reviews(id,facility_id,user_id,reviewer_name,rating,rating_skill,rating_service,rating_atmosphere,rating_cleanliness,rating_explanation,comment,reviewer_ip,is_flagged,flag_reason) VALUES
 ('fa910002-0000-4000-8000-000000000002','fa910001-0000-4000-8000-000000000003','fa910000-0000-4000-8000-000000000003','Synthetic editor',5,5,5,5,5,5,'日本一の美容師さんです','192.0.2.220',true,'医療広告ガイドラインの禁止表現: 日本一');
SELECT pg_temp.assert_limit((SELECT count(*)=1 FROM public.moderation_queue WHERE content_id='fa910002-0000-4000-8000-000000000002' AND status='pending'),'flagged review is queued');
SELECT pg_temp.assert_limit((SELECT count(*)=1 FROM public.moderate_review_content_atomic('fa910000-0000-4000-8000-000000000002',
  (SELECT id FROM public.moderation_queue WHERE content_id='fa910002-0000-4000-8000-000000000002' AND status='pending'),'pending','approved',NULL,NULL,
  p_expected_content_hash=>(SELECT public.moderation_review_context_hash(q,r) FROM public.moderation_queue q JOIN public.facility_reviews r ON r.id=q.content_id
    WHERE q.content_id='fa910002-0000-4000-8000-000000000002' AND q.status='pending'))),'moderator approves the false positive');
SELECT pg_temp.assert_limit((SELECT NOT is_flagged AND flag_reason IS NULL FROM public.facility_reviews WHERE id='fa910002-0000-4000-8000-000000000002'),'approval released the flag');
SELECT pg_temp.assert_limit((SELECT count(*)=1 FROM public.public_reviews WHERE id='fa910002-0000-4000-8000-000000000002'),'approved review is public');
SELECT pg_temp.assert_limit((SELECT rating_count=1 AND rating_avg=5 FROM public.facility_profiles WHERE id='fa910001-0000-4000-8000-000000000003'),'approved review is counted');
SELECT pg_temp.assert_limit((SELECT count(*)=1 FROM public.edit_review_atomic('fa910000-0000-4000-8000-000000000003','fa910002-0000-4000-8000-000000000002',
  '{"rating_skill":1,"rating_service":1,"rating_atmosphere":1,"rating_cleanliness":1,"rating_explanation":1,"comment":"日本一の美容師さんです","is_flagged":true,"flag_reason":"医療広告ガイドラインの禁止表現: 日本一"}')),'star-only edit applies');
SELECT pg_temp.assert_limit((SELECT rating=1 AND NOT is_flagged AND flag_reason IS NULL FROM public.facility_reviews WHERE id='fa910002-0000-4000-8000-000000000002'),'star-only edit keeps the approval');
SELECT pg_temp.assert_limit((SELECT count(*)=1 FROM public.public_reviews WHERE id='fa910002-0000-4000-8000-000000000002'),'star-only edit stays public');
SELECT pg_temp.assert_limit((SELECT rating_count=1 AND rating_avg=1 FROM public.facility_profiles WHERE id='fa910001-0000-4000-8000-000000000003'),'star-only edit stays in the rating with its new stars');
SELECT pg_temp.assert_limit(NOT EXISTS(SELECT 1 FROM public.moderation_queue WHERE content_id='fa910002-0000-4000-8000-000000000002' AND status='pending'),'star-only edit opens no moderation');
-- A text change is still moderated, and a later star-only edit keeps it pending.
SELECT pg_temp.assert_limit((SELECT count(*)=1 FROM public.edit_review_atomic('fa910000-0000-4000-8000-000000000003','fa910002-0000-4000-8000-000000000002',
  '{"rating_skill":4,"rating_service":4,"rating_atmosphere":4,"rating_cleanliness":4,"rating_explanation":4,"comment":"No.1 の美容師さんです","is_flagged":true,"flag_reason":"医療広告ガイドラインの禁止表現: No.1"}')),'text edit applies');
SELECT pg_temp.assert_limit((SELECT is_flagged AND flag_reason='医療広告ガイドラインの禁止表現: No.1' FROM public.facility_reviews WHERE id='fa910002-0000-4000-8000-000000000002'),'changed text is flagged');
SELECT pg_temp.assert_limit((SELECT count(*)=1 FROM public.moderation_queue WHERE content_id='fa910002-0000-4000-8000-000000000002' AND status='pending' AND auto_flags='["content_changed"]'::jsonb),'changed text is queued');
SELECT pg_temp.assert_limit(NOT EXISTS(SELECT 1 FROM public.public_reviews WHERE id='fa910002-0000-4000-8000-000000000002'),'changed text waits for moderation');
SELECT pg_temp.assert_limit((SELECT count(*)=1 FROM public.edit_review_atomic('fa910000-0000-4000-8000-000000000003','fa910002-0000-4000-8000-000000000002',
  '{"rating_skill":3,"rating_service":3,"rating_atmosphere":3,"rating_cleanliness":3,"rating_explanation":3,"comment":"No.1 の美容師さんです"}')),'star-only edit while pending applies');
SELECT pg_temp.assert_limit((SELECT rating=3 AND is_flagged AND flag_reason='医療広告ガイドラインの禁止表現: No.1' FROM public.facility_reviews WHERE id='fa910002-0000-4000-8000-000000000002'),'star-only edit keeps the pending flag');
SELECT pg_temp.assert_limit((SELECT count(*)=1 FROM public.moderation_queue WHERE content_id='fa910002-0000-4000-8000-000000000002' AND status='pending'),'still exactly one pending moderation');
-- Clearing the text is a text change: the existing flag stays until moderation decides.
SELECT pg_temp.assert_limit((SELECT count(*)=1 FROM public.edit_review_atomic('fa910000-0000-4000-8000-000000000003','fa910002-0000-4000-8000-000000000002',
  '{"rating_skill":3,"rating_service":3,"rating_atmosphere":3,"rating_cleanliness":3,"rating_explanation":3,"comment":null}')),'text cleared');
SELECT pg_temp.assert_limit((SELECT comment IS NULL AND is_flagged FROM public.facility_reviews WHERE id='fa910002-0000-4000-8000-000000000002'),'cleared text keeps the existing flag for moderation');
RESET ROLE;
ROLLBACK;
