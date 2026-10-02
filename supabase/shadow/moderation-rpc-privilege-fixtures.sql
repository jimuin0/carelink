-- Disposable DB only. No external I/O; every synthetic row is rolled back.
BEGIN;
SET LOCAL statement_timeout = '10s';
CREATE TEMP TABLE moderation_fixture_baseline AS SELECT count(*) AS rows FROM public.moderation_queue;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.moderation_queue WHERE content_id IN
    ('f42f0000-0000-4000-8000-000000000001', 'f42f0000-0000-4000-8000-000000000002')) THEN
    RAISE EXCEPTION 'moderation fixture namespace collision';
  END IF;
END $$;

-- This payload is accepted by the legacy definer body. Require a permission
-- error, not an empty result or a validation failure.
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.enqueue_moderation('[{"content_type":"review","content_id":"f42f0000-0000-4000-8000-000000000001","auto_flags":[]}]'::jsonb);
    RAISE EXCEPTION 'anonymous moderation RPC write accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.enqueue_moderation('[]'::jsonb);
    RAISE EXCEPTION 'anonymous empty moderation RPC call accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.enqueue_moderation('[{"content_type":"photo","content_id":"f42f0000-0000-4000-8000-000000000002","auto_flags":[]}]'::jsonb);
    RAISE EXCEPTION 'authenticated moderation RPC write accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.enqueue_moderation('[]'::jsonb);
    RAISE EXCEPTION 'authenticated empty moderation RPC call accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.moderation_queue) <> (SELECT rows FROM moderation_fixture_baseline) THEN
    RAISE EXCEPTION 'denied moderation calls changed queue data';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    WHERE p.oid = 'public.enqueue_moderation(jsonb)'::regprocedure
      AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) THEN RAISE EXCEPTION 'PUBLIC moderation execution grant remains'; END IF;
END $$;

SET LOCAL ROLE service_role;
DO $$
DECLARE
  payload jsonb := '[{"content_type":"review","content_id":"f42f0000-0000-4000-8000-000000000001","report_reason":"TEST-review","auto_flags":["TEST"]},{"content_type":"photo","content_id":"f42f0000-0000-4000-8000-000000000002","report_reason":"TEST-photo","auto_flags":[]}]';
BEGIN
  IF public.enqueue_moderation(payload) <> 2 THEN RAISE EXCEPTION 'service moderation batch not inserted'; END IF;
  IF public.enqueue_moderation(payload) <> 0 THEN RAISE EXCEPTION 'service moderation replay not deduplicated'; END IF;
  IF public.enqueue_moderation('[]'::jsonb) <> 0 THEN RAISE EXCEPTION 'service empty batch not a no-op'; END IF;
  IF (SELECT count(*) FROM public.moderation_queue WHERE content_id IN
    ('f42f0000-0000-4000-8000-000000000001', 'f42f0000-0000-4000-8000-000000000002') AND status = 'pending') <> 2 THEN
    RAISE EXCEPTION 'service moderation batch lost or duplicated';
  END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.moderation_queue) <> (SELECT rows + 2 FROM moderation_fixture_baseline) THEN
    RAISE EXCEPTION 'moderation batch changed unrelated queue rows';
  END IF;
END $$;
ROLLBACK;
