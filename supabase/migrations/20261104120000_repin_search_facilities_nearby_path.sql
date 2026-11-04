-- search_facilities_nearby の search_path を固定し直す（2026-11-04）。
--
-- 20261015140541 で search_path を public, extensions, pg_temp に固定していたが、
-- 20261030014653（診療科での絞り込み）が CREATE OR REPLACE FUNCTION で関数を作り直した。
-- CREATE OR REPLACE は関数の設定（proconfig）も新しい定義で置き換えるため、固定が外れていた。
-- 本番で proconfig が NULL になっていること、Supabase の検査（function_search_path_mutable）が
-- この関数を指摘したことを確認済み。
-- 関数の本文・権限・SECURITY INVOKER は変えない。
-- 同じ外れ方の再発は src/lib/__tests__/function-search-path-pin-guard.test.ts が CI で止める。
DO $$ BEGIN
 IF to_regclass('public.facility_profiles') IS NULL THEN RAISE EXCEPTION 'NOT_CARELINK_DATABASE'; END IF;
 IF has_schema_privilege('anon','public','CREATE') OR has_schema_privilege('authenticated','public','CREATE')
 OR has_schema_privilege('anon','extensions','CREATE') OR has_schema_privilege('authenticated','extensions','CREATE') THEN
 RAISE EXCEPTION 'FUNCTION_PATH_REQUIRES_TRUSTED_SCHEMAS'; END IF;
END $$;
ALTER FUNCTION public.search_facilities_nearby(double precision,double precision,double precision,text,integer,text,text[]) SET search_path = public, extensions, pg_temp;
