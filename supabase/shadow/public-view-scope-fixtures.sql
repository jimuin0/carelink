-- Synthetic, disposable PG17 only; no production business writes.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
DO $$ BEGIN
 IF current_database() NOT LIKE 'carelink_shadow%' THEN RAISE EXCEPTION 'shadow DB required'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id::text LIKE 'fa690000-%') THEN RAISE EXCEPTION 'fixture collision'; END IF;
END $$;
CREATE FUNCTION pg_temp.assert_scope(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'public scope: %',label; END IF; END $$;
-- Bootstrap uses a NULL identity; emulate verified JWT identities transactionally.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('fa690000-0000-4000-8000-000000000001','public-owner@example.invalid',now()),
 ('fa690000-0000-4000-8000-000000000002','public-other@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES
 ('fa690001-0000-4000-8000-000000000001','Public scope','synthetic-public-scope','その他','検証県','検証市','検証住所','draft'),
 ('fa690001-0000-4000-8000-000000000002','Private scope','synthetic-private-scope','その他','検証県','検証市','検証住所','draft');
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES
 ('fa690000-0000-4000-8000-000000000001','fa690001-0000-4000-8000-000000000001','owner'),
 ('fa690000-0000-4000-8000-000000000001','fa690001-0000-4000-8000-000000000002','admin');
\ir listing-verification-setup.sql
SELECT pg_temp.approve_synthetic_listing('fa690001-0000-4000-8000-000000000001' , 'fa690000-0000-4000-8000-000000000001');
UPDATE public.facility_profiles SET status='published' WHERE id IN ('fa690001-0000-4000-8000-000000000001');

INSERT INTO public.facility_menus(id,facility_id,category,name,price,is_published) VALUES
 ('fa690002-0000-4000-8000-000000000001','fa690001-0000-4000-8000-000000000001','その他','Public',500,true),
 ('fa690002-0000-4000-8000-000000000002','fa690001-0000-4000-8000-000000000001','その他','Draft',1,false),
 ('fa690002-0000-4000-8000-000000000003','fa690001-0000-4000-8000-000000000001','その他','Legacy',1000,NULL),
 ('fa690002-0000-4000-8000-000000000004','fa690001-0000-4000-8000-000000000002','その他','Private',200,true);
INSERT INTO public.coupons(id,facility_id,name,is_active,valid_from,valid_until) VALUES
 ('fa690003-0000-4000-8000-000000000001','fa690001-0000-4000-8000-000000000001','Current',true,(now() AT TIME ZONE 'Asia/Tokyo')::date,(now() AT TIME ZONE 'Asia/Tokyo')::date),
 ('fa690003-0000-4000-8000-000000000002','fa690001-0000-4000-8000-000000000001','Inactive',false,NULL,NULL),
 ('fa690003-0000-4000-8000-000000000003','fa690001-0000-4000-8000-000000000001','Future',true,(now() AT TIME ZONE 'Asia/Tokyo')::date+1,NULL),
 ('fa690003-0000-4000-8000-000000000004','fa690001-0000-4000-8000-000000000001','Expired',true,NULL,(now() AT TIME ZONE 'Asia/Tokyo')::date-1),
 ('fa690003-0000-4000-8000-000000000005','fa690001-0000-4000-8000-000000000002','Private',true,NULL,NULL);
INSERT INTO public.coupon_menus(coupon_id,menu_id)
 SELECT id,'fa690002-0000-4000-8000-000000000001'::uuid FROM public.coupons WHERE id::text LIKE 'fa690003-%';
SET LOCAL ROLE service_role;
INSERT INTO public.facility_reviews(id,facility_id,reviewer_name,rating,status,is_flagged,reviewer_ip) VALUES
 ('fa690004-0000-4000-8000-000000000001','fa690001-0000-4000-8000-000000000001','Public',4,'published',false,'192.0.2.69'),
 ('fa690004-0000-4000-8000-000000000002','fa690001-0000-4000-8000-000000000002','Private',4,'published',false,'192.0.2.70'),
 ('fa690004-0000-4000-8000-000000000003','fa690001-0000-4000-8000-000000000001','Flagged',4,'published',true,'192.0.2.71'),
 ('fa690004-0000-4000-8000-000000000004','fa690001-0000-4000-8000-000000000001','Hidden',4,'hidden',false,'192.0.2.72');
RESET ROLE;
SELECT pg_temp.assert_scope((SELECT reloptions @> ARRAY['security_invoker=true','security_barrier=true'] FROM pg_class WHERE oid='public.facility_card_view'::regclass),'card invoker barrier');
SELECT pg_temp.assert_scope((SELECT reloptions @> ARRAY['security_barrier=true'] FROM pg_class WHERE oid='public.public_reviews'::regclass),'review barrier');
SELECT pg_temp.assert_scope(NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='public_reviews' AND column_name IN ('user_id','reviewer_ip')),'review projection has no private identifiers');
SELECT pg_temp.assert_scope(bool_and(has_table_privilege(r,v,'SELECT') AND NOT has_table_privilege(r,v,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')),'views SELECT only for all API roles')
 FROM unnest(ARRAY['anon','authenticated','service_role']) r CROSS JOIN unnest(ARRAY['public.facility_card_view','public.public_reviews']) v;
SET LOCAL ROLE anon;
SELECT pg_temp.assert_scope((SELECT count(*)=1 AND min(min_price)=500 AND max(max_price)=1000 AND min(menu_count)=2 AND min(coupon_count)=1 FROM public.facility_card_view WHERE id::text LIKE 'fa690001-%'),'public card excludes private parent, draft prices and invalid coupons');
SELECT pg_temp.assert_scope((SELECT count(*)=2 FROM public.facility_menus WHERE id::text LIKE 'fa690002-%'),'anonymous direct menus exclude draft/private');
SELECT pg_temp.assert_scope((SELECT count(*)=1 FROM public.coupons WHERE id::text LIKE 'fa690003-%'),'anonymous coupons current/public only, inclusive JST bounds');
SELECT pg_temp.assert_scope((SELECT count(*)=1 FROM public.coupon_menus WHERE coupon_id::text LIKE 'fa690003-%'),'mapping inherits coupon visibility');
SELECT pg_temp.assert_scope((SELECT count(*)=1 FROM public.public_reviews WHERE id::text LIKE 'fa690004-%'),'public reviews exclude private parent, flagged and rejected');
SELECT pg_temp.assert_scope((SELECT count(*)=0 FROM public.facility_reviews WHERE id::text LIKE 'fa690004-%'),'anonymous cannot read private review base rows');
DO $$ BEGIN
 BEGIN
  DELETE FROM public.facility_card_view WHERE id='fa690001-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'view delete allowed';
 EXCEPTION WHEN insufficient_privilege OR object_not_in_prerequisite_state THEN NULL; END;
 BEGIN
  UPDATE public.public_reviews SET reviewer_name='Bad' WHERE id='fa690004-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'view update allowed';
 EXCEPTION WHEN insufficient_privilege OR object_not_in_prerequisite_state THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='fa690000-0000-4000-8000-000000000002';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_scope((SELECT count(*)=1 FROM public.coupons WHERE id::text LIKE 'fa690003-%'),'unrelated member cannot read hidden coupons');
SELECT pg_temp.assert_scope((SELECT count(*)=2 FROM public.facility_menus WHERE id::text LIKE 'fa690002-%'),'unrelated member cannot read draft menus');
SELECT pg_temp.assert_scope((SELECT count(*)=0 FROM public.facility_reviews WHERE id::text LIKE 'fa690004-%'),'unrelated member cannot read review base private columns');
RESET ROLE;
SET LOCAL request.jwt.claim.sub='fa690000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_scope((SELECT count(*)=5 FROM public.coupons WHERE id::text LIKE 'fa690003-%'),'owner retains future/expired/inactive/private coupons');
SELECT pg_temp.assert_scope((SELECT count(*)=5 FROM public.coupon_menus WHERE coupon_id::text LIKE 'fa690003-%'),'owner retains private coupon mappings');
SELECT pg_temp.assert_scope((SELECT count(*)=4 FROM public.facility_menus WHERE id::text LIKE 'fa690002-%'),'member retains own draft and private menus');
SELECT pg_temp.assert_scope((SELECT min(min_price)=500 AND min(menu_count)=2 AND min(coupon_count)=1 FROM public.facility_card_view WHERE id='fa690001-0000-4000-8000-000000000001'),'owner public card still excludes draft prices and inactive coupons');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_scope((SELECT count(*)=1 FROM public.coupons c
 JOIN public.facility_profiles f ON f.id=c.facility_id
 WHERE c.id::text LIKE 'fa690003-%' AND f.status='published' AND c.is_active=true
 AND (c.valid_from IS NULL OR c.valid_from<=(now() AT TIME ZONE 'Asia/Tokyo')::date)
 AND (c.valid_until IS NULL OR c.valid_until>=(now() AT TIME ZONE 'Asia/Tokyo')::date)),
 'service-role customer query explicitly filters published parent and validity');
RESET ROLE;
ROLLBACK;
