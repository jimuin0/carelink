// Synthetic data only: ephemeral CI PostgreSQL or an owned private Unix-socket
// smoke server. The local mode is NOT a substitute for the full migration job.
import { execFileSync, spawn } from 'node:child_process';
import { statSync, realpathSync } from 'node:fs';
import assert from 'node:assert/strict';

const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', 'carelink_shadow'];
const uuid = (kind, n) => `${kind}000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const uid = n => uuid('71', n);
const receipt = n => uuid('72', n);
const intent = n => uuid('73', n);
let dbEnv;
const children = new Set();
function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const force = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, 1000);
  force.unref();
  child.once('close', () => clearTimeout(force));
}
function query(sql) {
  return execFileSync('psql', args, { env: dbEnv, input: sql, encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }).trim();
}
function client(sql, name) {
  const child = spawn('psql', args, { env: { ...dbEnv, PGAPPNAME: name }, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  let output = '';
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { terminate(child); reject(new Error('fixture timeout')); }, 30000);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 4096) terminate(child);
    });
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); reject(new Error('fixture process unavailable')); });
    child.on('close', code => {
      children.delete(child);
      clearTimeout(timer);
      if (code !== 0) reject(new Error('fixture query failed'));
      else resolve(output.trim());
    });
    child.stdin.on('error', () => terminate(child));
  });
  if (sql !== undefined) child.stdin.end(sql);
  return { child, done, output: () => output };
}
async function contend(label, lock, calls, expire = false, timingCheck = '') {
  const name = `carelink-setup-${label}`;
  const coordinator = client(undefined, `${name}-coordinator`);
  coordinator.child.stdin.write(`BEGIN; ${lock}; SELECT 'locked';\n`);
  let ended = false;
  // Attach handlers immediately; an early failure must not become an unhandled rejection.
  const coordinated = coordinator.done.then(value => { ended = true; return value; }, () => { ended = true; return ''; });
  const deadline = Date.now() + 20000;
  while (!coordinator.output().includes('locked\n')) {
    if (ended || Date.now() > deadline) {
      terminate(coordinator.child); await coordinated;
      throw new Error('fixture lock not acquired');
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const workers = calls.map(sql => client(sql, name).done);
  coordinator.child.stdin.end(`
DO $$ DECLARE deadline timestamptz := clock_timestamp()+interval '20 seconds'; BEGIN
  LOOP
    PERFORM pg_stat_clear_snapshot();
    EXIT WHEN (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()
      AND application_name='${name}' AND state='active' AND wait_event_type='Lock')=${calls.length};
    IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'overlap not observed'; END IF;
    PERFORM pg_sleep(0.02);
  END LOOP;
END $$;
SELECT 'overlap-observed';
${timingCheck}
${expire ? "SELECT pg_sleep(2.1);" : ''}
COMMIT;`);
  const results = await Promise.allSettled(workers);
  assert.match(await coordinated, /overlap-observed/);
  assert.ok(results.every(result => result.status === 'fulfilled'));
  return results.map(result => result.value);
}
const userLock = n => `SELECT pg_advisory_xact_lock(hashtextextended('carelink-setup:${uid(n)}',0))`;
const rowLock = n => `SELECT id FROM public.salons WHERE id='${receipt(n)}' FOR UPDATE`;
function setup(user, selected, mode = 'legacy', expiring = false) {
  return `SET ROLE service_role; SELECT outcome||'|'||coalesce(facility_id::text,'')
    FROM public.setup_facility_from_registration('${uid(user)}','${mode}',
    ${mode === 'legacy' ? `'${receipt(selected)}'` : 'NULL'},
    ${mode === 'intent' ? `'${intent(selected)}',repeat('a',64),NULL` : `NULL,NULL,clock_timestamp()${expiring ? "-interval '72 hours'+interval '1 second'" : ''}`},
    '{}',true);`;
}
function assertOne(results, other) {
  assert.equal(results.filter(value => value.startsWith('created|')).length, 1);
  assert.equal(results.filter(value => value.startsWith(`${other}|`)).length, results.length - 1);
  if (other === 'replay' || other === 'already_member') {
    assert.equal(new Set(results.map(value => value.split('|')[1])).size, 1);
  }
}
async function main() {
  const socket = process.argv[2];
  if (process.env.PGSERVICE || process.env.PGSERVICEFILE || process.env.PGHOSTADDR) throw new Error('alternate connection refused');
  if (socket) {
    assert.match(socket, /^\/tmp\/carelink-setup-pg\.[a-zA-Z0-9]+$/);
    const info = statSync(socket);
    assert.equal(info.uid, process.getuid()); assert.equal(info.mode & 0o777, 0o700);
    assert.ok(info.isDirectory());
    dbEnv = { PATH: process.env.PATH, LC_ALL: 'C', PGHOST: socket, PGUSER: 'postgres', PGSSLMODE: 'disable' };
    assert.equal(query('SHOW listen_addresses'), '');
    assert.equal(realpathSync(query('SHOW data_directory')), realpathSync(`${socket}/data`));
  } else {
    assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.CI, 'true');
    assert.ok(['localhost', '127.0.0.1'].includes(process.env.PGHOST));
    assert.equal(process.env.PGPORT, '5432'); assert.equal(process.env.PGUSER, 'postgres');
    assert.ok(process.env.PGPASSWORD);
    dbEnv = { PATH: process.env.PATH, PGHOST: '127.0.0.1', PGPORT: '5432', PGUSER: 'postgres',
      PGPASSWORD: process.env.PGPASSWORD, PGSSLMODE: 'disable' };
  }
  assert.equal(query('SELECT current_database()'), 'carelink_shadow');
  query(`BEGIN;
INSERT INTO auth.users(id,email) SELECT ('71000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'setup-concurrency-'||n::text||'@example.invalid' FROM generate_series(1,100) n;
INSERT INTO public.salons(id,facility_name,business_type,email,phone,representative_name,contact_name,source)
SELECT ('72000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic branch '||n::text,
 'ヘアサロン','same-operator@example.invalid','09000000000','Synthetic','Synthetic','register' FROM generate_series(1,30) n;
INSERT INTO public.salon_submission_intents(id,proof_hash,canonical_version,hmac_scheme,
 payload_hmac,salon_id,committed_at,prepare_expires_at)
SELECT ('73000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,repeat('a',64),1,'proof-hkdf-sha256-v1',
 repeat('b',64),('72000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now(),now()+interval '1 day' FROM generate_series(24,27) n;
COMMIT;`);
  const twenty = fn => Array.from({ length: 20 }, (_, n) => fn(n));
  assertOne(await contend('same', userLock(1), twenty(() => setup(1, 1))), 'replay');
  assertOne(await contend('branches', userLock(2), twenty(n => setup(2, n + 2))), 'already_member');
  assertOne(await contend('users', rowLock(22), twenty(n => setup(n + 3, 22))), 'conflict');
  assertOne(await contend('versions', userLock(23), twenty(n => setup(23, 24, n % 2 ? 'intent' : 'legacy'))), 'replay');
  for (const [label, lock, calls] of [
    ['legacy-user-expiry', userLock(24), twenty(() => setup(24, 23, 'legacy', true))],
    ['legacy-row-expiry', rowLock(23), twenty(n => setup(25 + n, 23, 'legacy', true))],
  ]) {
    const results = await contend(label, lock, calls, true);
    assert.ok(results.every(value => value === 'unverified|'));
  }
  for (const [selected, label, lock, calls] of [
    [25, 'intent-user-expiry', userLock(45), twenty(() => setup(45, 25, 'intent'))],
    [26, 'intent-row-expiry', rowLock(26), twenty(n => setup(46 + n, 26, 'intent'))],
  ]) {
    query(`UPDATE public.salon_submission_intents SET created_at=clock_timestamp()-interval '72 hours'+interval '2 seconds' WHERE id='${intent(selected)}'`);
    // If process startup was too slow, fail this run rather than count a
    // now()-based implementation as a successful lock-time expiry check.
    const timingCheck = `DO $$ BEGIN
      IF (SELECT max(xact_start) FROM pg_stat_activity WHERE datname=current_database()
          AND application_name='carelink-setup-${label}' AND state='active') >=
        (SELECT created_at+interval '72 hours' FROM public.salon_submission_intents WHERE id='${intent(selected)}')
      THEN RAISE EXCEPTION 'clients did not start before expiry'; END IF;
    END $$;`;
    const results = await contend(label, lock, calls, true, timingCheck);
    assert.ok(results.every(value => value === 'unverified|'));
  }
  const unclaim = `SET ROLE service_role; WITH changed AS (UPDATE public.salons SET claimed_by_user_id=NULL,claimed_at=NULL
    WHERE id='${receipt(27)}' AND claimed_facility_id IS NULL AND claimed_by_user_id IS NULL AND claimed_at IS NULL RETURNING id)
    SELECT 'cleared|'||count(*)::text FROM changed;`;
  assert.equal(query(`SELECT (claimed_by_user_id IS NULL AND claimed_at IS NULL AND claimed_facility_id IS NULL)::text
    FROM public.salons WHERE id='${receipt(27)}'`), 'true');
  const race = await contend('unclaim', rowLock(27), [setup(66, 27), unclaim]);
  assert.match(race[0], /^created\|/); assert.match(race[1], /^cleared\|[01]$/);
  // Deterministic losing schedule: an operator read the null legacy values
  // above, setup has now committed, then that stale clear MUST affect zero rows.
  // Merely accepting either ordering in the concurrent race cannot prove CAS.
  assert.equal(query(unclaim), 'cleared|0');
  assert.equal(query(`SELECT count(*) FROM public.salons WHERE id='${receipt(27)}'
    AND claimed_facility_id IS NOT NULL AND claimed_by_user_id='${uid(66)}' AND claimed_at IS NOT NULL`), '1');
  assert.equal(query(`SELECT count(*) FROM public.salons WHERE id::text LIKE '72000000-%' AND claimed_facility_id IS NOT NULL`), '5');
  assert.equal(query(`SELECT count(*) FROM public.webhook_retry_queue WHERE webhook_type='facility_welcome'
    AND payload->>'user_id' LIKE '71000000-%'`), '5');
  console.log('Facility setup concurrency passed: 8 x 20 observed lock-waiting clients plus setup/unclaim race; exact single claims, no cross-branch merge, expiry after both locks, 5 atomic welcomes. Synthetic disposable DB only.');
}
main().catch(() => {
  console.error('Facility setup concurrency contract failed. No production access was authorized.');
  process.exitCode = 1;
}).finally(() => {
  for (const child of children) terminate(child);
});
