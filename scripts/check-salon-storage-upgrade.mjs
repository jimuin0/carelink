// Runs the actual migration's storage section against synthetic historical
// policy states. Every case rolls back. Never a production repair command.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

function main() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true'
    || !['localhost', '127.0.0.1'].includes(process.env.PGHOST)
    || process.env.PGPORT !== '5432' || process.env.PGUSER !== 'postgres'
    || !process.env.PGPASSWORD || process.env.PGSERVICE || process.env.PGSERVICEFILE || process.env.PGHOSTADDR) {
    console.error('Registration storage upgrade environment refused before database access.');
    process.exitCode = 1;
    return;
  }
  const source = readFileSync(new URL('../supabase/migrations/20260926000003_salon_photo_manifest.sql', import.meta.url), 'utf8');
  const blocks = [...source.matchAll(/-- BEGIN SALON STORAGE RECONCILIATION\n([\s\S]*?)-- END SALON STORAGE RECONCILIATION/g)];
  if (blocks.length !== 1 || /\b(?:BEGIN|COMMIT|ROLLBACK)\s*;/i.test(blocks[0][1])) {
    throw new Error('migration section boundary invalid');
  }
  const section = blocks[0][1];
  const env = { PATH: process.env.PATH, PGHOST: '127.0.0.1', PGPORT: '5432',
    PGUSER: 'postgres', PGPASSWORD: process.env.PGPASSWORD, PGSSLMODE: 'disable' };
  const run = sql => execFileSync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', 'carelink_shadow'],
    { env, encoding: 'utf8', input: sql, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
  const guard = `BEGIN;
DO $$ BEGIN
  IF current_database() <> 'carelink_shadow'
    OR EXISTS (SELECT 1 FROM public.salons)
    OR EXISTS (SELECT 1 FROM public.salon_submission_intents)
    OR EXISTS (SELECT 1 FROM storage.objects) THEN
    RAISE EXCEPTION 'empty disposable storage required';
  END IF;
END $$;
CREATE FUNCTION pg_temp.require(ok boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'storage upgrade assertion failed'; END IF;
END $$;
CREATE TEMP TABLE untouched_policies AS SELECT * FROM pg_policies
  WHERE schemaname='storage' AND tablename='objects'
  AND policyname NOT IN ('Allow anonymous upload','Allow anonymous upload images only','salon_legacy_authenticated_image_insert');
DROP POLICY IF EXISTS "Allow anonymous upload" ON storage.objects;
DROP POLICY IF EXISTS "Allow anonymous upload images only" ON storage.objects;
DROP POLICY IF EXISTS "salon_legacy_authenticated_image_insert" ON storage.objects;
`;
  for (const name of ['legacy', 'image-only', 'both', 'strict-bucket']) {
    const legacy = name !== 'image-only';
    const imageOnly = name === 'image-only' || name === 'both';
    const strict = name === 'strict-bucket';
    const setup = `${legacy ? `CREATE POLICY "Allow anonymous upload" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id='carelink-uploads');` : ''}
${imageOnly ? `CREATE POLICY "Allow anonymous upload images only" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id='carelink-uploads' AND storage.extension(name) IN ('png','jpg'));` : ''}
UPDATE storage.buckets SET public=${strict ? 'false' : 'true'},file_size_limit=${strict ? '5242880' : 'NULL'},
  allowed_mime_types=${strict ? "ARRAY['image/png']" : 'NULL'} WHERE id='carelink-uploads';`;
    const output = run(`${guard}${setup}\n${section}
SELECT pg_temp.require((SELECT count(*)=0 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Allow anonymous upload'));
SELECT pg_temp.require((SELECT count(*)=1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
  AND policyname='Allow anonymous upload images only' AND roles=ARRAY['anon']::name[] AND cmd='INSERT'));
SELECT pg_temp.require((SELECT public=${strict ? 'false' : 'true'} AND file_size_limit=${strict ? '5242880' : '10485760'}
  AND allowed_mime_types=${strict ? "ARRAY['image/png']" : "ARRAY['image/jpeg','image/png','image/webp','image/gif']"}
  FROM storage.buckets WHERE id='carelink-uploads'));
SELECT pg_temp.require(NOT EXISTS (
  (SELECT * FROM untouched_policies EXCEPT SELECT * FROM pg_policies)
  UNION ALL
  (SELECT * FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
    AND policyname NOT IN ('Allow anonymous upload images only','salon_legacy_authenticated_image_insert')
    EXCEPT SELECT * FROM untouched_policies)));
-- The shadow bootstrap does not enable Storage RLS; enable it solely within
-- this rolled-back fixture to test expressions with the actual role.
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT INSERT ON storage.objects TO anon;
SET LOCAL ROLE anon;
INSERT INTO storage.objects(bucket_id,name) VALUES ('carelink-uploads','salons/synthetic.png');
DO $$ DECLARE path text; BEGIN
  FOREACH path IN ARRAY ARRAY['salon-intents/synthetic.png','other/synthetic.png','salons/synthetic.svg'] LOOP
    BEGIN
      INSERT INTO storage.objects(bucket_id,name) VALUES ('carelink-uploads',path);
      RAISE EXCEPTION 'forbidden upload permitted';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
END $$;
RESET ROLE;
SELECT 'upgrade-ok';
ROLLBACK;`);
    if (!output.includes('upgrade-ok')) throw new Error('missing upgrade completion');
    console.log(`Storage upgrade ${name}: passed and rolled back.`);
  }
  // Deliberately invalid states must fail at their explicit reconciliation
  // guard, not at a later SQL syntax, permission or connection failure.
  for (const name of ['missing-policy', 'wrong-role', 'incompatible-mime']) {
    const setup = name === 'missing-policy' ? '' : `CREATE POLICY "Allow anonymous upload" ON storage.objects FOR INSERT TO ${name === 'wrong-role' ? 'authenticated' : 'anon'} WITH CHECK (bucket_id='carelink-uploads');`;
    const mime = name === 'incompatible-mime' ? "UPDATE storage.buckets SET allowed_mime_types=ARRAY['application/pdf'] WHERE id='carelink-uploads';" : '';
    const expected = name === 'incompatible-mime' ? 'registration bucket MIME configuration requires reconciliation' : 'registration upload policy requires reconciliation';
    // Catch the expected exception inside the transaction, preserving the
    // distinction from psql failure and proving no partial change escaped.
    const output = run(`${guard}${setup}${mime}
DO $case$ BEGIN
  BEGIN
    EXECUTE $migration$${section}$migration$;
    RAISE EXCEPTION 'invalid configuration unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> '${expected}' THEN RAISE; END IF;
  END;
END $case$;
SELECT 'rejection-ok';
ROLLBACK;`);
    if (!output.includes('rejection-ok')) throw new Error('missing rejection completion');
    console.log(`Storage upgrade ${name}: explicit rejection passed and rolled back.`);
  }
}
try { main(); } catch {
  console.error('Registration storage upgrade contract failed; no production repair was authorized.');
  process.exitCode = 1;
}
