-- Synthetic counts exceeding the PostgREST default row cap. Rollback only.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='20s';
DO $$ BEGIN IF current_database() NOT IN ('carelink_shadow','carelink_manual_20261001')
  THEN RAISE EXCEPTION 'disposable shadow database required'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_chain(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'chain fixture: %',label; END IF; END $$;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
('e1000000-0000-4000-8000-000000000001','chain-owner@example.invalid',now());
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES
('e2000000-0000-4000-8000-000000000001','Synthetic chain','synthetic-chain','その他','検証県','検証市','検証住所','draft'),
('e2000000-0000-4000-8000-000000000002','Synthetic chain empty','synthetic-chain-empty','その他','検証県','検証市','検証住所','draft');
INSERT INTO public.facility_members(user_id,facility_id,role) VALUES
('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','owner'),
('e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002','admin');
INSERT INTO public.bookings(facility_id,customer_name,booking_date,start_time,end_time,status,total_price,created_at)
SELECT 'e2000000-0000-4000-8000-000000000001','Synthetic',DATE '2030-01-01'+n,'10:00','11:00','cancelled',0,
  CASE WHEN n=1 THEN TIMESTAMPTZ '2026-09-30 14:59:59Z' ELSE TIMESTAMPTZ '2026-09-30 15:00:00Z' END
FROM generate_series(1,1001) n;
SELECT pg_temp.assert_chain(has_function_privilege('service_role','public.get_chain_statistics(uuid,uuid[],timestamptz)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_chain_statistics(uuid,uuid[],timestamptz)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.get_chain_statistics(uuid,uuid[],timestamptz)','EXECUTE'),'service-only RPC');
SET LOCAL ROLE service_role;
DO $$ DECLARE rows jsonb; BEGIN
  rows:=public.get_chain_statistics('e1000000-0000-4000-8000-000000000001',
    ARRAY['e2000000-0000-4000-8000-000000000001'::uuid,'e2000000-0000-4000-8000-000000000002'::uuid],'2026-09-30 15:00Z');
  PERFORM pg_temp.assert_chain(jsonb_array_length(rows)=2 AND (rows->0->>'booking_count')::int=1001
    AND (rows->0->>'monthly_bookings')::int=1000 AND (rows->1->>'booking_count')::int=0
    AND rows->1->>'nps_score' IS NULL,'full counts and JST month boundary, empty is measured');
  BEGIN PERFORM public.get_chain_statistics('e1000000-0000-4000-8000-000000000001',
    ARRAY['e2000000-0000-4000-8000-000000000001'::uuid,'e2000000-0000-4000-8000-000000000003'::uuid],now());
    RAISE EXCEPTION 'cross-tenant count allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.get_chain_statistics('e1000000-0000-4000-8000-000000000001',
    ARRAY['e2000000-0000-4000-8000-000000000001'::uuid,'e2000000-0000-4000-8000-000000000001'::uuid],now());
    RAISE EXCEPTION 'duplicate accepted'; EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'CHAIN_INPUT_INVALID' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
UPDATE public.facility_members SET role='staff' WHERE facility_id='e2000000-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN PERFORM public.get_chain_statistics('e1000000-0000-4000-8000-000000000001',
    ARRAY['e2000000-0000-4000-8000-000000000002'::uuid],now());
    RAISE EXCEPTION 'revoked role allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
