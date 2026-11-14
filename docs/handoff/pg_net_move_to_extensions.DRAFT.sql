-- 未適用の下書き。本人の明示承認なしに本番へ適用しない（2026-10-29 時点で承認なし）。
-- supabase/migrations に置かないのは、db push で意図せず適用されるのを防ぐため。
--
-- 目的: 未使用の pg_net を public から extensions へ置き直し、Security Advisor の
-- extension_in_public（pg_net）を解消する。pg_net は SET SCHEMA できない
-- （extrelocatable=false）ため、同じ版を作り直す。
-- 前提が 1 つでも崩れていれば、何も変えずに例外で止まる。
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
DECLARE
  queued bigint;
  responses bigint;
  outside_deps bigint;
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension
                 WHERE extname = 'pg_net' AND extversion = '0.20.0'
                   AND extnamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'pg_net is not 0.20.0 in public; stop and review';
  END IF;
  -- 作り直すと net の表は空になる。送信待ち・送信結果が 1 行でもあれば止める。
  EXECUTE 'SELECT count(*) FROM net.http_request_queue' INTO queued;
  EXECUTE 'SELECT count(*) FROM net._http_response' INTO responses;
  IF queued > 0 OR responses > 0 THEN
    RAISE EXCEPTION 'pg_net has % queued / % responses; stop and review', queued, responses;
  END IF;
  -- pg_net 自身の内部オブジェクト以外（アプリの関数・ビュー等）が依存していれば止める。
  SELECT count(*) INTO outside_deps
  FROM pg_depend d
  WHERE d.deptype = 'n'
    AND d.refobjid IN (SELECT objid FROM pg_depend x JOIN pg_extension e ON e.oid = x.refobjid
                       WHERE e.extname = 'pg_net' AND x.deptype = 'e')
    AND NOT EXISTS (SELECT 1 FROM pg_depend o WHERE o.classid = d.classid AND o.objid = d.objid
                      AND o.deptype IN ('a', 'i', 'e'));
  IF outside_deps > 0 THEN
    RAISE EXCEPTION '% objects outside pg_net depend on it; stop and review', outside_deps;
  END IF;
END
$guard$;

DROP EXTENSION pg_net;
CREATE EXTENSION pg_net WITH SCHEMA extensions VERSION '0.20.0';

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension
                 WHERE extname = 'pg_net' AND extversion = '0.20.0'
                   AND extnamespace = 'extensions'::regnamespace
                   AND extowner = 'supabase_admin'::regrole) THEN
    RAISE EXCEPTION 'pg_net was not recreated as expected';
  END IF;
  IF to_regprocedure('net.http_get(text,jsonb,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'net.http_get is missing after recreate';
  END IF;
END
$verify$;
COMMIT;

-- 元に戻す（COMMIT 後に問題が分かった場合。隔離環境で状態・指紋とも完全一致を確認済み）:
-- BEGIN; DROP EXTENSION pg_net; CREATE EXTENSION pg_net WITH SCHEMA public VERSION '0.20.0'; COMMIT;
