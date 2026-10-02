/** @jest-environment node */
// Explicit isolated PG17 suite; not selected by default testMatch.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { diffFingerprint } from '../../src/lib/schema-drift';

it('actual RPC JSON preserves literals through generator, cron engine and CLI', async () => {
  const db = process.env.FINGERPRINT_PG17_DB;
  const host = process.env.PGHOST;
  if (!db || !/^carelink_(shadow|monitor)[a-z0-9_]*$/.test(db) ||
      !host || !(host.startsWith('/') || ['localhost', '127.0.0.1', '::1'].includes(host))) {
    throw new Error('isolated shadow DB and local PGHOST are required');
  }
  const root = join(__dirname, '../..');
  const generator = await import(join(root, 'scripts/fingerprint-json.mjs'));
  const cli = await import(join(root, 'scripts/schema-diff.mjs'));
  const sql = `BEGIN;
    DO $$ BEGIN
      -- Replay includes 10 synthetic facilities from 20260321000004.
      IF (SELECT count(*) FROM public.facility_profiles) <> 10
        OR EXISTS (SELECT 1 FROM public.contacts) OR EXISTS (SELECT 1 FROM auth.users)
        OR EXISTS (SELECT 1 FROM public.bookings)
      THEN RAISE EXCEPTION 'not the isolated migration replay fixture'; END IF;
    END $$;
    CREATE TABLE public.fp_roundtrip(value text DEFAULT 'a  b', CONSTRAINT fp_roundtrip_check CHECK(value <> 'a  b'));
    ALTER TABLE public.fp_roundtrip ENABLE ROW LEVEL SECURITY;
    CREATE POLICY fp_roundtrip_policy ON public.fp_roundtrip USING (value <> 'a  b');
    CREATE INDEX fp_roundtrip_index ON public.fp_roundtrip(value) WHERE value <> 'a  b';
    CREATE TYPE public.fp_roundtrip_enum AS ENUM ('label','tail ');
    SELECT public.get_schema_fingerprint();
    ALTER TABLE public.fp_roundtrip ALTER value SET DEFAULT E'a\\nrelation|fake|r\\nb';
    SELECT public.get_schema_fingerprint();
    ALTER TABLE public.fp_roundtrip ALTER value SET DEFAULT 'a  b';
    ALTER TABLE public.fp_roundtrip DROP CONSTRAINT fp_roundtrip_check;
    ALTER TABLE public.fp_roundtrip ADD CONSTRAINT fp_roundtrip_check CHECK(value <> 'a b');
    SELECT public.get_schema_fingerprint();
    ALTER TABLE public.fp_roundtrip DROP CONSTRAINT fp_roundtrip_check;
    ALTER TABLE public.fp_roundtrip ADD CONSTRAINT fp_roundtrip_check CHECK(value <> 'a  b');
    ALTER POLICY fp_roundtrip_policy ON public.fp_roundtrip USING(value <> U&'a  b\\3000');
    SELECT public.get_schema_fingerprint();
    ALTER POLICY fp_roundtrip_policy ON public.fp_roundtrip USING(value <> 'a  b');
    DROP INDEX public.fp_roundtrip_index;
    CREATE INDEX fp_roundtrip_index ON public.fp_roundtrip(value) WHERE value <> U&'a  b\\FEFF';
    SELECT public.get_schema_fingerprint();
    DROP INDEX public.fp_roundtrip_index;
    CREATE INDEX fp_roundtrip_index ON public.fp_roundtrip(value) WHERE value <> 'a  b';
    ALTER TYPE public.fp_roundtrip_enum RENAME VALUE 'tail ' TO E'tail\\n';
    SELECT public.get_schema_fingerprint();
    ALTER TYPE public.fp_roundtrip_enum RENAME VALUE E'tail\\n' TO 'tail ';
    SELECT public.get_schema_fingerprint();
    ROLLBACK;`;
  const raw = execFileSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', db],
    { input: sql, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  // Each psql response is one JSON value; escaped payload LF is never split.
  const snapshots: string[][] = raw.trim().split('\n').map((response) => generator.canonicalRecords(response));
  expect(snapshots).toHaveLength(7);
  const baseline = snapshots[0];
  for (const actual of snapshots.slice(1, 6)) {
    const ts = diffFingerprint(baseline, actual);
    const js = cli.diffFingerprints(baseline, actual);
    expect(ts.vacuous).toBe(false);
    expect(ts.missing).toHaveLength(1);
    expect(ts.extra).toHaveLength(1);
    expect(js.missing).toEqual(ts.missing);
    expect(js.extra).toEqual(ts.extra);
    expect(JSON.parse(JSON.stringify(actual))).toEqual(actual);
    expect(cli.relationNames(actual).has('fake')).toBe(false);
  }
  expect(snapshots.at(-1)).toEqual(baseline);
});
