\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN IF current_database() NOT IN ('carelink_shadow_batch2_points','carelink_shadow') OR current_setting('server_version_num')::int/10000<>17 THEN RAISE EXCEPTION 'owned PG17 shadow required'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_referral(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'referral apply fixture: %',label; END IF; END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('bea10000-0000-4000-8000-000000000001','referrer@example.invalid',now()),
 ('bea10000-0000-4000-8000-000000000002','referred@example.invalid',now()),
 ('bea10000-0000-4000-8000-000000000003','second@example.invalid',now()),
 ('bea10000-0000-4000-8000-000000000004','failure@example.invalid',now());
INSERT INTO public.referral_codes(user_id,code,used_count)
 VALUES('bea10000-0000-4000-8000-000000000001','TESTABCD',NULL),('bea10000-0000-4000-8000-000000000003','OTHERABC',0);
SELECT pg_temp.assert_referral(NOT has_function_privilege('anon','public.apply_referral_code_atomic(uuid,text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.apply_referral_code_atomic(uuid,text)','EXECUTE'),'no client privilege bypass');
SET LOCAL ROLE service_role;
DO $$ DECLARE a record;b record; BEGIN
 SELECT * INTO a FROM public.apply_referral_code_atomic('bea10000-0000-4000-8000-000000000002','testabcd');
 SELECT * INTO b FROM public.apply_referral_code_atomic('bea10000-0000-4000-8000-000000000002','TESTABCD');
 PERFORM pg_temp.assert_referral(a.use_id=b.use_id AND NOT a.replayed AND b.replayed,'same actor/code result replays without another use');
 PERFORM pg_temp.assert_referral((SELECT used_count=1 FROM public.referral_codes WHERE code='TESTABCD'),'NULL base and replay yield one authoritative count');
 PERFORM pg_temp.assert_referral(NOT EXISTS(SELECT 1 FROM public.user_points WHERE user_id IN ('bea10000-0000-4000-8000-000000000001','bea10000-0000-4000-8000-000000000002')),'applying does not grant premature points');
 BEGIN PERFORM public.apply_referral_code_atomic('bea10000-0000-4000-8000-000000000001','TESTABCD'); RAISE EXCEPTION 'self use accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'REFERRAL_SELF_USE' THEN RAISE; END IF; END;
 BEGIN PERFORM public.apply_referral_code_atomic('bea10000-0000-4000-8000-000000000002','OTHERABC'); RAISE EXCEPTION 'different replay accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'REFERRAL_ALREADY_APPLIED' THEN RAISE; END IF; END;
 BEGIN PERFORM public.apply_referral_code_atomic('bea10000-0000-4000-8000-000000000004','bad'); RAISE EXCEPTION 'invalid code accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'REFERRAL_CODE_INVALID' THEN RAISE; END IF; END;
 -- The legacy consumer inserts first, then performs a stale CAS. The trigger
 -- already incremented in the INSERT transaction, so zero CAS rows are safe.
 INSERT INTO public.referral_uses(code,referred_user_id,referrer_user_id)
  VALUES('TESTABCD','bea10000-0000-4000-8000-000000000003','bea10000-0000-4000-8000-000000000001');
 UPDATE public.referral_codes SET used_count=2 WHERE code='TESTABCD' AND used_count=1;
 PERFORM pg_temp.assert_referral(NOT FOUND AND (SELECT used_count=2 FROM public.referral_codes WHERE code='TESTABCD'),'old zero-row CAS cannot lose or double count');
END $$;
RESET ROLE;
CREATE FUNCTION pg_temp.drop_referral_count() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.code='TESTABCD' THEN RETURN NULL; END IF; RETURN NEW; END $$;
CREATE TRIGGER synthetic_referral_count_zero BEFORE UPDATE ON public.referral_codes FOR EACH ROW EXECUTE FUNCTION pg_temp.drop_referral_count();
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.apply_referral_code_atomic('bea10000-0000-4000-8000-000000000004','TESTABCD'); RAISE EXCEPTION 'zero-row count accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'REFERRAL_COUNT_NOT_CONFIRMED' THEN RAISE; END IF; END;
 PERFORM pg_temp.assert_referral(NOT EXISTS(SELECT 1 FROM public.referral_uses WHERE referred_user_id='bea10000-0000-4000-8000-000000000004'),'counter zero-row rolls back use');
END $$;
RESET ROLE;
DROP TRIGGER synthetic_referral_count_zero ON public.referral_codes;
SET LOCAL ROLE service_role;
SELECT * FROM public.apply_referral_code_atomic('bea10000-0000-4000-8000-000000000004','TESTABCD');
SELECT pg_temp.assert_referral((SELECT used_count=3 FROM public.referral_codes WHERE code='TESTABCD'),'retry after rollback remains reachable');
RESET ROLE;
ROLLBACK;
