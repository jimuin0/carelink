-- Disposable shadow only. Every catalog change is rolled back; no business rows.
\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE public.fingerprint_literal_fixture (value text DEFAULT 'a  b', CONSTRAINT fp_literal_check CHECK (value <> 'a  b'));
ALTER TABLE public.fingerprint_literal_fixture ENABLE ROW LEVEL SECURITY;
CREATE POLICY fp_literal_policy ON public.fingerprint_literal_fixture USING (value <> 'a  b');
CREATE INDEX fp_literal_index ON public.fingerprint_literal_fixture(value) WHERE value <> 'a  b';
CREATE TYPE public.fingerprint_literal_enum AS ENUM ('label', 'tail ');
CREATE TABLE public."fingerprint
identifier　" (value text);

DO $test$
DECLARE
  before_fp jsonb;
  after_fp jsonb;
  literal text;
  trim_char text;
  definition text;
  mutations integer := 0;
BEGIN
  before_fp := public.get_schema_fingerprint();
  IF jsonb_array_length(before_fp) < 500 THEN RAISE EXCEPTION 'vacuous fingerprint'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(before_fp) r WHERE strpos(r, E'fingerprint\nidentifier　') > 0) THEN
    RAISE EXCEPTION 'identifier literal was modified';
  END IF;
  FOREACH literal IN ARRAY ARRAY['a b', E'a\nb', 'a  b ', U&'a  b\202F', U&'a  b\205F', U&'a  b\3000', U&'a  b\FEFF', E'a\nrelation|fake|r\nb'] LOOP
    EXECUTE format('ALTER TABLE public.fingerprint_literal_fixture ALTER value SET DEFAULT %L', literal);
    after_fp := public.get_schema_fingerprint();
    IF after_fp = before_fp THEN RAISE EXCEPTION 'DEFAULT mutation hidden'; END IF;
    EXECUTE 'ALTER TABLE public.fingerprint_literal_fixture ALTER value SET DEFAULT ''a  b''';
    IF public.get_schema_fingerprint() <> before_fp THEN RAISE EXCEPTION 'DEFAULT restore differs'; END IF;

    ALTER TABLE public.fingerprint_literal_fixture DROP CONSTRAINT fp_literal_check;
    EXECUTE format('ALTER TABLE public.fingerprint_literal_fixture ADD CONSTRAINT fp_literal_check CHECK (value <> %L)', literal);
    IF public.get_schema_fingerprint() = before_fp THEN RAISE EXCEPTION 'CHECK mutation hidden'; END IF;
    ALTER TABLE public.fingerprint_literal_fixture DROP CONSTRAINT fp_literal_check;
    ALTER TABLE public.fingerprint_literal_fixture ADD CONSTRAINT fp_literal_check CHECK (value <> 'a  b');
    IF public.get_schema_fingerprint() <> before_fp THEN RAISE EXCEPTION 'CHECK restore differs'; END IF;

    EXECUTE format('ALTER POLICY fp_literal_policy ON public.fingerprint_literal_fixture USING (value <> %L)', literal);
    IF public.get_schema_fingerprint() = before_fp THEN RAISE EXCEPTION 'policy mutation hidden'; END IF;
    ALTER POLICY fp_literal_policy ON public.fingerprint_literal_fixture USING (value <> 'a  b');
    IF public.get_schema_fingerprint() <> before_fp THEN RAISE EXCEPTION 'policy restore differs'; END IF;

    DROP INDEX public.fp_literal_index;
    EXECUTE format('CREATE INDEX fp_literal_index ON public.fingerprint_literal_fixture(value) WHERE value <> %L', literal);
    IF public.get_schema_fingerprint() = before_fp THEN RAISE EXCEPTION 'index mutation hidden'; END IF;
    DROP INDEX public.fp_literal_index;
    CREATE INDEX fp_literal_index ON public.fingerprint_literal_fixture(value) WHERE value <> 'a  b';
    IF public.get_schema_fingerprint() <> before_fp THEN RAISE EXCEPTION 'index restore differs'; END IF;
    mutations := mutations + 4;
  END LOOP;

  FOREACH literal IN ARRAY ARRAY['tail', E'tail\n', U&'tail\202F', U&'tail\205F', U&'tail\3000', U&'tail\FEFF'] LOOP
    EXECUTE format('ALTER TYPE public.fingerprint_literal_enum RENAME VALUE %L TO %L', 'tail ', literal);
    after_fp := public.get_schema_fingerprint();
    IF after_fp = before_fp OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(after_fp) r WHERE r = 'enum|fingerprint_literal_enum|label,' || literal) THEN
      RAISE EXCEPTION 'enum mutation hidden or modified';
    END IF;
    EXECUTE format('ALTER TYPE public.fingerprint_literal_enum RENAME VALUE %L TO %L', literal, 'tail ');
    IF public.get_schema_fingerprint() <> before_fp THEN RAISE EXCEPTION 'enum restore differs'; END IF;
    mutations := mutations + 1;
  END LOOP;

  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
    WHERE conrelid = 'public.facility_profiles'::regclass AND conname = 'published_facility_location_present';
  IF definition IS NULL THEN RAISE EXCEPTION 'published location constraint missing'; END IF;
  FOREACH trim_char IN ARRAY ARRAY[U&'\202F', U&'\205F', U&'\3000', U&'\FEFF'] LOOP
    IF strpos(definition, trim_char) = 0 THEN RAISE EXCEPTION 'fixture missing Unicode trim character'; END IF;
    ALTER TABLE public.facility_profiles DROP CONSTRAINT published_facility_location_present;
    EXECUTE 'ALTER TABLE public.facility_profiles ADD CONSTRAINT published_facility_location_present ' || replace(definition, trim_char, '');
    IF public.get_schema_fingerprint() = before_fp THEN RAISE EXCEPTION 'Unicode CHECK mutation hidden'; END IF;
    ALTER TABLE public.facility_profiles DROP CONSTRAINT published_facility_location_present;
    EXECUTE 'ALTER TABLE public.facility_profiles ADD CONSTRAINT published_facility_location_present ' || definition;
    IF public.get_schema_fingerprint() <> before_fp THEN RAISE EXCEPTION 'Unicode CHECK restore differs'; END IF;
    mutations := mutations + 1;
  END LOOP;

  GRANT EXECUTE ON FUNCTION public.get_schema_fingerprint() TO anon;
  IF public.get_schema_fingerprint() = before_fp THEN RAISE EXCEPTION 'named role ACL mutation hidden'; END IF;
  REVOKE EXECUTE ON FUNCTION public.get_schema_fingerprint() FROM anon;
  IF public.get_schema_fingerprint() <> before_fp THEN RAISE EXCEPTION 'ACL restore differs'; END IF;
  EXECUTE 'ALTER TABLE public.fingerprint_literal_fixture ALTER value SET DEFAULT ( ''a  b'' :: text )';
  IF public.get_schema_fingerprint() <> before_fp THEN RAISE EXCEPTION 'identical deparse formatting differs'; END IF;
  RAISE NOTICE 'fingerprint catalog controls passed：% mutations and restores', mutations + 1;
END;
$test$;

SET LOCAL ROLE anon;
DO $denied$ BEGIN
  BEGIN PERFORM public.get_schema_fingerprint(); RAISE EXCEPTION 'anon RPC allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $denied$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $denied$ BEGIN
  BEGIN PERFORM public.get_schema_fingerprint(); RAISE EXCEPTION 'authenticated RPC allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $denied$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $service$ DECLARE fp jsonb; BEGIN
  fp := public.get_schema_fingerprint();
  IF jsonb_typeof(fp) IS DISTINCT FROM 'array' OR coalesce(jsonb_array_length(fp), 0) < 500 THEN
    RAISE EXCEPTION 'service RPC returned invalid or vacuous fingerprint';
  END IF;
END $service$;
RESET ROLE;
ROLLBACK;
