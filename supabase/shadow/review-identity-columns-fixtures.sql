-- Disposable, synthetic namespace only. Every write is rolled back.
-- Proves migration 20261023120100 on a real PG17 schema: a shop owner/admin
-- can no longer read the reviewer's IP address, account id, booking id,
-- submission operation id or the moderation flag reason (same-IP grouping
-- evidence and operator notes) (before: table-level SELECT returned every column of
-- every review of the shop), while the owner's list columns and the
-- publish/hide UPDATE(status) keep working and RLS still scopes the rows.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
  IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'shadow DB required'; END IF;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'fa920000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_identity(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'review identity columns: %',label; END IF; END $$;
-- Bootstrap uses a NULL identity; emulate verified JWT identities transactionally.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;

DO $$ DECLARE role_name text; col text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    PERFORM pg_temp.assert_identity(NOT has_table_privilege(role_name,'public.facility_reviews','SELECT'),'no table-wide SELECT for '||role_name);
    FOREACH col IN ARRAY ARRAY['reviewer_ip','user_id','booking_id','client_operation_id','flag_reason'] LOOP
      PERFORM pg_temp.assert_identity(NOT has_column_privilege(role_name,'public.facility_reviews',col,'SELECT'),role_name||' cannot read '||col);
    END LOOP;
    FOREACH col IN ARRAY ARRAY['id','facility_id','reviewer_name','rating','comment','status','is_flagged','created_at'] LOOP
      PERFORM pg_temp.assert_identity(has_column_privilege(role_name,'public.facility_reviews',col,'SELECT'),role_name||' keeps '||col);
    END LOOP;
  END LOOP;
  PERFORM pg_temp.assert_identity(has_column_privilege('authenticated','public.facility_reviews','status','UPDATE')
    AND NOT has_column_privilege('authenticated','public.facility_reviews','comment','UPDATE'),'owner visibility toggle preserved, content still server-only');
  PERFORM pg_temp.assert_identity(has_table_privilege('service_role','public.facility_reviews','SELECT'),'server reads every column');
END $$;

INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('fa920000-0000-4000-8000-000000000001','review-identity-owner@example.invalid',now()),
 ('fa920000-0000-4000-8000-000000000002','review-identity-author@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES
 ('fa920001-0000-4000-8000-000000000001','Synthetic identity','synthetic-review-identity','その他','検証県','検証市','検証住所','draft');
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES
 ('fa920000-0000-4000-8000-000000000001','fa920001-0000-4000-8000-000000000001','owner');
\ir listing-verification-setup.sql
SELECT pg_temp.approve_synthetic_listing('fa920001-0000-4000-8000-000000000001' , 'fa920000-0000-4000-8000-000000000001');
UPDATE public.facility_profiles SET status='published' WHERE id IN ('fa920001-0000-4000-8000-000000000001');

SET LOCAL ROLE service_role;
-- flag_reason is written directly (not through the cron) only to have a value
-- to probe; the assertion is about the column privilege, not about flagging.
INSERT INTO public.facility_reviews(id,facility_id,user_id,reviewer_name,rating,comment,reviewer_ip,client_operation_id,flag_reason) VALUES
 ('fa920002-0000-4000-8000-000000000001','fa920001-0000-4000-8000-000000000001','fa920000-0000-4000-8000-000000000002',
  'Nickname',2,'Synthetic critical review','192.0.2.230','fa920009-0000-4000-8000-000000000001',
  'duplicate_facility: 2 unflagged reviews from same IP for same facility');
RESET ROLE;

-- Shop owner (PostgREST runs as authenticated with the owner's JWT).
SET LOCAL request.jwt.claim.sub='fa920000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_identity((SELECT count(*)=1 AND bool_and(reviewer_name='Nickname' AND comment='Synthetic critical review')
  FROM (SELECT id,reviewer_name,rating,comment,status,is_flagged,created_at FROM public.facility_reviews
    WHERE facility_id='fa920001-0000-4000-8000-000000000001') listed),'owner still lists the shop reviews');
DO $$ DECLARE probe text; BEGIN
  FOREACH probe IN ARRAY ARRAY[
    'SELECT reviewer_ip FROM public.facility_reviews',
    'SELECT user_id FROM public.facility_reviews',
    'SELECT booking_id FROM public.facility_reviews',
    'SELECT client_operation_id FROM public.facility_reviews',
    'SELECT flag_reason FROM public.facility_reviews',
    'SELECT * FROM public.facility_reviews',
    'SELECT id FROM public.facility_reviews WHERE user_id=''fa920000-0000-4000-8000-000000000002''',
    'SELECT id FROM public.facility_reviews WHERE reviewer_ip=''192.0.2.230''',
    'SELECT r.id FROM public.facility_reviews r JOIN public.bookings b ON b.user_id=r.user_id'] LOOP
    BEGIN
      EXECUTE probe;
      RAISE EXCEPTION 'owner read reviewer identity: %',probe;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
END $$;
DO $$ DECLARE changed integer; BEGIN
  UPDATE public.facility_reviews SET status='hidden'
    WHERE id='fa920002-0000-4000-8000-000000000001' AND facility_id='fa920001-0000-4000-8000-000000000001';
  GET DIAGNOSTICS changed = ROW_COUNT;
  PERFORM pg_temp.assert_identity(changed=1,'owner can still hide a review');
  UPDATE public.facility_reviews SET status='published'
    WHERE id='fa920002-0000-4000-8000-000000000001' AND facility_id='fa920001-0000-4000-8000-000000000001';
  GET DIAGNOSTICS changed = ROW_COUNT;
  PERFORM pg_temp.assert_identity(changed=1,'owner can still publish a review');
END $$;
RESET ROLE;

-- The author is not a member: the own-row policy still scopes by user_id
-- (policy expressions are not subject to the caller's column privileges).
SET LOCAL request.jwt.claim.sub='fa920000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_identity((SELECT count(*)=1 FROM public.facility_reviews WHERE id='fa920002-0000-4000-8000-000000000001'),'author still sees the own review through RLS');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT pg_temp.assert_identity((SELECT count(*)=0 FROM public.facility_reviews WHERE id='fa920002-0000-4000-8000-000000000001'),'anonymous still reads no base rows');
SELECT pg_temp.assert_identity((SELECT count(*)=1 AND bool_and(is_member) FROM public.public_reviews WHERE id='fa920002-0000-4000-8000-000000000001'),'public view unaffected');
RESET ROLE;
ROLLBACK;
