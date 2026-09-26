// Deliberately restricted to GitHub's ephemeral PostgreSQL service. Never use
// this as a production probe: it creates synthetic receipts and outbox rows.
import { execFileSync, spawn } from 'node:child_process';

const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', 'carelink_shadow'];
const intent = '63000000-0000-4000-8000-000000000001';
const expiringIntent = '63000000-0000-4000-8000-000000000002';
const payload = JSON.stringify({
  facility_name: 'Synthetic concurrent fixture', business_type: 'ヘアサロン',
  representative_name: 'Synthetic representative', contact_name: 'Synthetic contact',
  email: 'concurrent-fixture@example.invalid', phone: '09000000000',
  features: [], photo_urls: [], has_parking: false, source: 'register',
});
async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true'
    || !['localhost', '127.0.0.1'].includes(process.env.PGHOST)
    || process.env.PGPORT !== '5432' || process.env.PGUSER !== 'postgres'
    || !process.env.PGPASSWORD || process.env.PGSERVICE || process.env.PGSERVICEFILE || process.env.PGHOSTADDR) {
    console.error('Registration concurrency environment refused before database access.');
    process.exitCode = 1;
    return;
  }
  const dbEnv = { PATH: process.env.PATH, PGHOST: '127.0.0.1', PGPORT: '5432',
    PGUSER: 'postgres', PGPASSWORD: process.env.PGPASSWORD, PGSSLMODE: 'disable' };
  execFileSync('psql', args, { env: dbEnv, encoding: 'utf8', input: `
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'carelink_shadow' OR EXISTS (SELECT 1 FROM public.salons)
    OR EXISTS (SELECT 1 FROM public.salon_submission_intents) THEN
    RAISE EXCEPTION 'empty disposable schema required';
  END IF;
END $$;
INSERT INTO public.salon_submission_intents
  (id, proof_hash, canonical_version, hmac_scheme, prepare_expires_at)
VALUES ('${intent}',repeat('a',64),1,'proof-hkdf-sha256-v1',now()+interval '1 day'),
  ('${expiringIntent}',repeat('a',64),1,'proof-hkdf-sha256-v1',now()+interval '1 day');
COMMIT;`, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });

  const outcomes = await contend(dbEnv, intent, false);
  const receipts = new Set();
  let committed = 0;
  let replay = 0;
  for (const outcome of outcomes) {
    const match = /^(committed|replay)\|([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.exec(outcome);
    if (!match) throw new Error('invalid concurrent outcome');
    receipts.add(match[2]);
    if (match[1] === 'committed') committed++;
    else replay++;
  }
  if (committed !== 1 || replay !== 19 || receipts.size !== 1) throw new Error('duplicate or missing receipt');
  const expired = await contend(dbEnv, expiringIntent, true);
  if (expired.length !== 20 || expired.some(outcome => outcome !== 'unverified|')) {
    throw new Error('capability expiration during lock wait was not enforced');
  }
  const counts = execFileSync('psql', args, { env: dbEnv, encoding: 'utf8', timeout: 30000,
    stdio: ['pipe', 'pipe', 'pipe'], input: `SELECT
      (SELECT count(*) FROM public.salons)::text || '|' ||
      (SELECT count(*) FROM public.webhook_retry_queue WHERE registration_id=(SELECT salon_id FROM public.salon_submission_intents WHERE id='${intent}'))::text || '|' ||
      (SELECT count(*) FROM public.salon_submission_intents WHERE id='${intent}' AND salon_id IS NOT NULL)::text || '|' ||
      (SELECT count(*) FROM public.salon_submission_intents WHERE id='${expiringIntent}' AND salon_id IS NULL)::text;` }).trim();
  if (counts !== '1|2|1|1') throw new Error('atomic receipt/outbox count mismatch');
  console.log('Registration concurrency passed: 20 lock-waiting calls, 1 receipt, 2 distinct logical notifications; another 20 calls rejected after capability expiry during lock wait. Disposable CI data only.');
}

async function contend(dbEnv, targetIntent, expireWhileWaiting) {
  const sql = `SET ROLE service_role;
SELECT outcome || '|' || coalesce(receipt_id::text, '') FROM public.commit_salon_submission(
  '${targetIntent}', repeat('a',64), 1::smallint, 'proof-hkdf-sha256-v1', repeat('b',64),
  $registration$${payload}$registration$::jsonb);`;
  // Hold the intent row until all 20 clients are actually waiting for a lock.
  // Merely spawning 20 processes does not prove overlapping database work.
  let announceReady;
  const ready = new Promise(resolve => { announceReady = resolve; });
  const coordinator = spawn('psql', args, { env: dbEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  let coordinatorOutput = '';
  const coordinated = new Promise(resolve => {
    const timer = setTimeout(() => { coordinator.kill('SIGTERM'); announceReady(false); resolve(false); }, 30000);
    coordinator.stdout.on('data', chunk => {
      coordinatorOutput += chunk;
      if (coordinatorOutput.length > 4096) coordinator.kill('SIGTERM');
      if (coordinatorOutput.includes('intent-locked\n')) announceReady(true);
    });
    coordinator.stderr.resume();
    coordinator.on('error', () => { clearTimeout(timer); announceReady(false); resolve(false); });
    coordinator.on('close', code => {
      clearTimeout(timer);
      announceReady(false);
      resolve(code === 0 && coordinatorOutput.includes('contention-observed'));
    });
    coordinator.stdin.on('error', () => { coordinator.kill('SIGTERM'); announceReady(false); });
  });
  coordinator.stdin.end(`BEGIN;
SELECT id FROM public.salon_submission_intents WHERE id='${targetIntent}' FOR UPDATE;
SELECT 'intent-locked';
DO $$ DECLARE deadline timestamptz := clock_timestamp() + interval '20 seconds'; BEGIN
  LOOP
    PERFORM pg_stat_clear_snapshot();
    EXIT WHEN (SELECT count(*) FROM pg_stat_activity
      WHERE datname = current_database() AND application_name = 'carelink-intent-client'
        AND state = 'active' AND wait_event_type = 'Lock') = 20;
    IF clock_timestamp() > deadline THEN RAISE EXCEPTION 'twenty blocked clients not observed'; END IF;
    PERFORM pg_sleep(0.05);
  END LOOP;
END $$;
SELECT 'contention-observed';
${expireWhileWaiting ? `
-- Move this synthetic row's deadline just beyond all observed call starts,
-- then let real time cross it while the lock remains held. Using now() in the
-- RPC would incorrectly authorize these already-started transactions.
UPDATE public.salon_submission_intents
  SET created_at=clock_timestamp()-interval '72 hours'+interval '1 second'
  WHERE id='${targetIntent}';
SELECT pg_sleep(1.1);
` : ''}
COMMIT;`);
  if (!await ready) { await coordinated; throw new Error('coordinator did not acquire intent lock'); }

  const outcomes = await Promise.all(Array.from({ length: 20 }, () => new Promise((resolve, reject) => {
    const child = spawn('psql', args, { env: { ...dbEnv, PGAPPNAME: 'carelink-intent-client' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let size = 0;
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('concurrent query timeout')); }, 30000);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 4096) { child.kill('SIGTERM'); reject(new Error('unexpected query output')); }
      else output += chunk;
    });
    // Synthetic fixture errors are reported by a fixed label, never raw SQL or credentials.
    child.stderr.resume();
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error('concurrent query failed'));
      else resolve(output.trim());
    });
    child.stdin.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdin.end(sql);
  })));
  if (!await coordinated) throw new Error('database contention was not observed');
  return outcomes;
}

main().catch(() => {
  console.error('Registration concurrency contract failed; no production probe was authorized.');
  process.exitCode = 1;
});
