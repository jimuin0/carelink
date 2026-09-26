-- Synthetic transaction in the disposable CI database, never production.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'carelink_shadow' THEN
    RAISE EXCEPTION 'disposable carelink_shadow required';
  END IF;
END $$;
INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
VALUES ('67000000-0000-4000-8000-000000000001','Synthetic location fixture','synthetic-location-one','ヘアサロン','','','','draft'),
  ('67000000-0000-4000-8000-000000000002','Synthetic location fixture','synthetic-location-two','ヘアサロン','愛知県','合成市','合成町1','draft');
CREATE FUNCTION pg_temp.expect_location_check(statement text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE violated text; rejected boolean := false;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violated = CONSTRAINT_NAME;
    IF violated <> 'published_facility_location_present' THEN RAISE; END IF;
    rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'missing location guard'; END IF;
END $$;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_location_check($sql$UPDATE public.facility_profiles SET status='published'
  WHERE id='67000000-0000-4000-8000-000000000001'$sql$);
-- One invalid row aborts the entire bulk statement: never report partial save.
SELECT pg_temp.expect_location_check($sql$UPDATE public.facility_profiles SET status='published'
  WHERE id IN ('67000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000002')$sql$);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.facility_profiles
    WHERE id IN ('67000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000002') AND status <> 'draft') THEN
    RAISE EXCEPTION 'bulk location update was partially saved';
  END IF;
END $$;
UPDATE public.facility_profiles SET status='published' WHERE id='67000000-0000-4000-8000-000000000002';
-- Every String.trim whitespace character, for every location column. Test each
-- separately so a missing character cannot hide behind another rejected one.
DO $$ DECLARE col text; ws text; BEGIN
  FOREACH col IN ARRAY ARRAY['prefecture','city','address'] LOOP
    FOREACH ws IN ARRAY string_to_array(U&'\0009|\000A|\000B|\000C|\000D|\0020|\00A0|\1680|\2000|\2001|\2002|\2003|\2004|\2005|\2006|\2007|\2008|\2009|\200A|\2028|\2029|\202F|\205F|\3000|\FEFF', '|') LOOP
      PERFORM pg_temp.expect_location_check(format('UPDATE public.facility_profiles SET %I=%L WHERE id=%L',
        col, ws, '67000000-0000-4000-8000-000000000002'));
    END LOOP;
    PERFORM pg_temp.expect_location_check(format('UPDATE public.facility_profiles SET %I=%L WHERE id=%L',
      col, '', '67000000-0000-4000-8000-000000000002'));
  END LOOP;
END $$;
-- Non-blank edits work, and making the facility draft before clearing works.
UPDATE public.facility_profiles SET address='合成町2' WHERE id='67000000-0000-4000-8000-000000000002';
UPDATE public.facility_profiles SET status='draft',address='' WHERE id='67000000-0000-4000-8000-000000000002';
-- A stale application gate's earlier observation cannot authorize publication.
SELECT pg_temp.expect_location_check($sql$UPDATE public.facility_profiles SET status='published'
  WHERE id='67000000-0000-4000-8000-000000000002'$sql$);
RESET ROLE;
-- Negative control: drop only in the rolled-back synthetic transaction. The
-- identical forbidden write must now succeed, proving the fixture isn't merely
-- rejected by unrelated role/RLS/column permissions.
ALTER TABLE public.facility_profiles DROP CONSTRAINT published_facility_location_present;
SET LOCAL ROLE service_role;
UPDATE public.facility_profiles SET status='published' WHERE id='67000000-0000-4000-8000-000000000002';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.facility_profiles WHERE id='67000000-0000-4000-8000-000000000002'
    AND status='published' AND address='') THEN RAISE EXCEPTION 'negative control not exercised'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
\echo 'published location fixtures passed; all synthetic writes and negative control rolled back'
