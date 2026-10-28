#!/bin/bash
set -euo pipefail
PG_BIN=${PG_BIN:-/usr/local/opt/postgresql@17/bin}
cd "$(dirname "$0")/.."
TEST_DIR=$(mktemp -d /tmp/carelink-review-count.XXXXXX)
cleanup() { "$PG_BIN/pg_ctl" -D "$TEST_DIR/data" -m fast stop >/dev/null 2>&1 || true; rm -rf "$TEST_DIR"; }
trap cleanup EXIT
"$PG_BIN/initdb" -D "$TEST_DIR/data" -A trust --no-locale >/dev/null
"$PG_BIN/pg_ctl" -D "$TEST_DIR/data" -o "-k $TEST_DIR -c listen_addresses=''" -l "$TEST_DIR/log" start >/dev/null
export PGHOST="$TEST_DIR" PGUSER="$(id -un)"
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -d postgres <<'SQL'
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.facility_profiles(id uuid PRIMARY KEY, status text);
CREATE TABLE public.facility_reviews(id uuid PRIMARY KEY, facility_id uuid, status text, is_flagged boolean);
CREATE TABLE public.review_helpful(review_id uuid, user_id uuid);
ALTER TABLE public.review_helpful ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.review_helpful TO authenticated;
CREATE POLICY only_own ON public.review_helpful FOR SELECT TO authenticated USING (user_id = nullif(current_setting('request.jwt.claim.sub', true),'')::uuid);
INSERT INTO public.facility_profiles VALUES ('00000000-0000-4000-8000-000000000001','published'), ('00000000-0000-4000-8000-000000000002','draft');
INSERT INTO public.facility_reviews VALUES ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','published',false), ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','published',true), ('00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000001','draft',false), ('00000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000002','published',false);
INSERT INTO public.review_helpful SELECT r.id, v.id FROM public.facility_reviews r CROSS JOIN (VALUES ('00000000-0000-4000-8000-000000000021'::uuid), ('00000000-0000-4000-8000-000000000022'::uuid)) AS v(id);
SQL
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -d postgres -f supabase/migrations/20261023110100_review_helpful_counts_rpc.sql
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -d postgres -f supabase/migrations/20261028023012_review_counts_private_helper.sql
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -d postgres <<'SQL'
DO $$ BEGIN
  IF (SELECT prosecdef FROM pg_proc WHERE oid='public.get_review_helpful_counts(uuid[])'::regprocedure) THEN RAISE EXCEPTION 'public function is still definer'; END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid='carelink_review_private.get_review_helpful_counts(uuid[])'::regprocedure) THEN RAISE EXCEPTION 'private helper not definer'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public', 'graphql_public') AND p.proname='get_review_helpful_counts' AND p.prosecdef AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))) THEN RAISE EXCEPTION 'security advisor condition still matches'; END IF;
  IF has_table_privilege('anon','public.review_helpful','SELECT') OR has_column_privilege('anon','public.review_helpful','user_id','SELECT') THEN RAISE EXCEPTION 'anon can read votes'; END IF;
END $$;
SET ROLE anon;
DO $$ DECLARE result jsonb; BEGIN
 SELECT jsonb_agg(to_jsonb(t)) INTO result FROM public.get_review_helpful_counts(ARRAY['00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000014']::uuid[]) t;
 IF result <> '[{"review_id":"00000000-0000-4000-8000-000000000011","helpful_count":2}]'::jsonb THEN RAISE EXCEPTION 'bad anon result %', result; END IF;
 BEGIN PERFORM user_id FROM public.review_helpful; RAISE EXCEPTION 'anon direct read allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub='00000000-0000-4000-8000-000000000021';
DO $$ BEGIN
 IF (SELECT helpful_count FROM public.get_review_helpful_counts(ARRAY['00000000-0000-4000-8000-000000000011']::uuid[])) <> 2 THEN RAISE EXCEPTION 'wrong signed-in count'; END IF;
 IF (SELECT count(*) FROM public.review_helpful) <> 4 OR EXISTS (SELECT 1 FROM public.review_helpful WHERE user_id <> '00000000-0000-4000-8000-000000000021') THEN RAISE EXCEPTION 'RLS failed'; END IF;
END $$;
RESET ROLE;
SELECT 'synthetic anonymous/authenticated count and voter privacy checks passed' AS result;
SQL
