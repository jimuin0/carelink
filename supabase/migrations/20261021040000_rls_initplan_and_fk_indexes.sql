-- Supabase performance advisor (2026-10-21):
--   auth_rls_initplan (90): policies call auth.uid()/auth.jwt()/auth.role() per
--     row. Wrapping the call in a scalar sub-select lets the planner evaluate it
--     once per statement. The predicate is unchanged; roles and commands are kept
--     because ALTER POLICY only replaces the expressions given.
--   unindexed_foreign_keys (50): foreign keys whose columns are not the leading
--     columns of any index make cascades and joins scan the referencing table.
-- Both changes are derived from the catalog so the shadow database and
-- production, which the schema fingerprint proves identical, converge.
DO $guard$
BEGIN
  IF to_regclass('public.facility_profiles') IS NULL THEN
    RAISE EXCEPTION 'not the CareLink database';
  END IF;
END
$guard$;

-- Plain CREATE INDEX holds a SHARE lock on each table until the transaction
-- commits, and apply_migration runs this file in one transaction, so
-- CONCURRENTLY is not available here. Production public data was 24 MB in
-- total on 2026-10-21 (largest table cron_logs, ~24k rows; most referencing
-- tables near-empty), so the batch completes in milliseconds. Never queue
-- behind an existing lock: fail fast instead of stalling writes.
-- Future index additions on large tables must use CREATE INDEX CONCURRENTLY
-- outside a transaction.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $rls$
DECLARE
  p record;
  wrap constant text := '(?<!SELECT )auth\.(uid|jwt|role)\(\)';
  new_qual text;
  new_check text;
BEGIN
  FOR p IN
    SELECT tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (coalesce(qual, '') ~ wrap OR coalesce(with_check, '') ~ wrap)
    ORDER BY tablename, policyname
  LOOP
    new_qual := regexp_replace(p.qual, wrap, '(SELECT auth.\1())', 'g');
    new_check := regexp_replace(p.with_check, wrap, '(SELECT auth.\1())', 'g');
    EXECUTE format('ALTER POLICY %I ON public.%I%s%s', p.policyname, p.tablename,
      CASE WHEN p.qual IS NOT NULL THEN ' USING (' || new_qual || ')' ELSE '' END,
      CASE WHEN p.with_check IS NOT NULL THEN ' WITH CHECK (' || new_check || ')' ELSE '' END);
  END LOOP;
END
$rls$;

DO $fk$
DECLARE
  fk record;
  idx_name text;
BEGIN
  FOR fk IN
    SELECT c.conrelid::regclass AS tbl, cl.relname AS table_name, c.conname, c.conkey,
      (SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord)
         FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE c.contype = 'f' AND n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = c.conrelid
          AND (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(c.conkey)] = c.conkey)
    ORDER BY cl.relname, c.conname
  LOOP
    -- Identifiers stop at 63 bytes; a truncated name gets a hash of the full
    -- constraint name so two long names can never collapse into one and be
    -- silently skipped by IF NOT EXISTS.
    idx_name := 'idx_fk_' || fk.conname;
    IF octet_length(idx_name) > 63 THEN
      idx_name := left(idx_name, 54) || '_' || left(md5(fk.conname), 8);
    END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (%s)', idx_name, fk.tbl, fk.cols);
  END LOOP;
END
$fk$;
