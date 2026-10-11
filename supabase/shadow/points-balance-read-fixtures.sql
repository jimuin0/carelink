BEGIN;
DO $$ BEGIN
  IF current_database() NOT IN ('carelink_shadow','carelink_monitor_points') THEN
    RAISE EXCEPTION 'disposable points read database required';
  END IF;
END $$;
CREATE FUNCTION pg_temp.assert_points_read(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'points read fixture: %',label; END IF; END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('fea11000-0000-4000-8000-000000000001','points-read-owner@example.invalid',now()),
 ('fea11000-0000-4000-8000-000000000002','points-read-other@example.invalid',now());
INSERT INTO public.user_points(user_id,points,reason)
 SELECT 'fea11000-0000-4000-8000-000000000001',1,'synthetic read fixture '||i FROM generate_series(1,2001) i;
INSERT INTO public.user_points(user_id,points,reason) VALUES
 ('fea11000-0000-4000-8000-000000000001',-500,'synthetic read debit'),
 ('fea11000-0000-4000-8000-000000000002',37,'synthetic other owner');
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
SELECT set_config('request.jwt.claim.sub','fea11000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_points_read(public.get_user_points_balance('fea11000-0000-4000-8000-000000000001')=1501,'full 2002-row ledger includes debit');
DO $$ BEGIN
 BEGIN PERFORM public.get_user_points_balance('fea11000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'another owner allowed'; EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM <> 'POINTS_BALANCE_OWNER_REQUIRED' THEN RAISE; END IF; END;
 BEGIN PERFORM public.get_user_points_balance(NULL); RAISE EXCEPTION 'null owner allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.get_user_points_balance('fea11000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'anonymous balance allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.assert_points_read(public.get_user_points_balance('fea11000-0000-4000-8000-000000000002')=37,'verified service owner resolution retained');
RESET ROLE;
SELECT pg_temp.assert_points_read(NOT has_function_privilege('anon','public.get_user_points_balance(uuid)','EXECUTE'),'anon ACL');
SELECT pg_temp.assert_points_read(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.get_user_points_balance(uuid)'::regprocedure),'invoker RLS preserved');
SELECT 'points balance whole ledger / owner / role / rollback checks passed';
ROLLBACK;
