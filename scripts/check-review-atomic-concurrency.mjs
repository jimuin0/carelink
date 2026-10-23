// Synthetic-only PG17 race contracts. No HTTP, Storage, provider or production I/O.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
const shadowDocker = process.argv[2] === '--local-docker-shadow';
const localDocker = shadowDocker || process.argv[2] === '--local-docker';
const database = process.env.CARELINK_REVIEW_TEST_DB || 'carelink_shadow';
assert.match(database, /^carelink_shadow[a-z0-9_]*$/);
assert.ok(process.argv.length <= 3 && (!process.argv[2] || localDocker), 'unsupported runner mode');
if (process.env.PGSERVICE || process.env.PGSERVICEFILE || process.env.PGHOSTADDR) throw new Error('alternate connection refused');
let binary, args, dbEnv;
if (localDocker) {
  assert.match(process.env.DOCKER_HOST || '', /^unix:\/\/\/Users\/kam\/\.carelink-vm-20261008\/\.docker\/run\/docker\.sock$/);
  binary = 'docker'; args = ['exec', '-i', 'supabase_db_carelink', 'psql', '-U', 'postgres', '-d', database];
  dbEnv = { PATH: process.env.PATH, DOCKER_HOST: process.env.DOCKER_HOST, DOCKER_CONFIG: process.env.DOCKER_CONFIG };
} else {
  assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.CI, 'true');
  assert.ok(['localhost', '127.0.0.1'].includes(process.env.PGHOST)); assert.equal(process.env.PGPORT, '5432');
  assert.equal(process.env.PGUSER, 'postgres'); assert.ok(process.env.PGPASSWORD);
  binary = 'psql'; args = ['-d', database];
  dbEnv = { PATH: process.env.PATH, PGHOST: '127.0.0.1', PGPORT: '5432', PGUSER: 'postgres', PGPASSWORD: process.env.PGPASSWORD, PGSSLMODE: 'disable' };
}
args.push('-X', '-qAt', '-v', 'ON_ERROR_STOP=1');
const children = new Set();
const query = sql => execFileSync(binary, args, { env: dbEnv, input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }).trim();
function client(sql, name) {
  const child = spawn(binary, args, { env: dbEnv, stdio: ['pipe', 'pipe', 'pipe'] }); children.add(child);
  let output = '', errors = '';
  const done = new Promise(resolve => {
    const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
    child.stdout.on('data', data => { output += data; if (output.length > 4096) child.kill('SIGTERM'); });
    child.stderr.on('data', data => { errors += data; if (errors.length > 4096) child.kill('SIGTERM'); });
    child.once('error', () => { clearTimeout(timer); resolve({ code: -1, output, errors }); });
    child.once('close', code => { clearTimeout(timer); children.delete(child); resolve({ code, output: output.trim(), errors }); });
    child.stdin.on('error', () => child.kill('SIGTERM'));
  });
  child.stdin.write(`SET application_name='${name}'; SET statement_timeout='20s';\n`);
  if (sql !== undefined) child.stdin.end(sql);
  return { child, done, output: () => output };
}
async function orderedRace(label, firstSql, secondSql) {
  const workerName = `review-${label}`;
  const first = client(undefined, `${workerName}-coordinator`);
  let coordinatorExited = false;
  void first.done.then(() => { coordinatorExited = true; });
  first.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; ${firstSql}; SELECT 'locked';\n`);
  const deadline = Date.now() + 20000;
  while (!first.output().includes('locked\n')) {
    if (coordinatorExited || Date.now() > deadline) throw new Error('coordinator lock failed');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const second = client(`SET ROLE service_role; ${secondSql};`, workerName);
  first.child.stdin.end(`RESET ROLE; DO $$ DECLARE deadline timestamptz:=clock_timestamp()+interval '15 seconds'; BEGIN
    LOOP PERFORM pg_stat_clear_snapshot();
      EXIT WHEN EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
        AND application_name='${workerName}' AND state='active' AND wait_event_type='Lock');
      IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'overlap not observed'; END IF;
      PERFORM pg_sleep(0.02);
    END LOOP; END $$; SELECT 'overlap-observed'; COMMIT;`);
  const [a, b] = await Promise.all([first.done, second.done]);
  assert.equal(a.code, 0, a.errors); assert.match(a.output, /overlap-observed/);
  return b;
}
const actor = 'fa130000-0000-4000-8000-000000000001';
const fid = 'fa130001-0000-4000-8000-000000000001';
const review = 'fa130002-0000-4000-8000-000000000001';
const other = 'fa130002-0000-4000-8000-000000000002';
let created = false;
const insert = (id, ip, createdAt = 'now()') => `INSERT INTO public.facility_reviews(id,facility_id,user_id,reviewer_name,rating,rating_skill,rating_service,rating_atmosphere,rating_cleanliness,rating_explanation,comment,reviewer_ip,created_at)
 VALUES('${id}','${fid}','${actor}','Synthetic race',4,4,4,4,4,4,'Initial','${ip}',${createdAt})`;
async function main() {
 assert.equal(query('SELECT current_database()'), database);
 assert.equal(query("SELECT current_setting('server_version_num')::integer BETWEEN 170000 AND 179999"), 't');
 assert.equal(query(`SELECT EXISTS(SELECT 1 FROM auth.users WHERE id='${actor}') OR EXISTS(SELECT 1 FROM public.facility_profiles WHERE id='${fid}')`),'f');
 query(`BEGIN;
 INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${actor}','synthetic-review-race@example.invalid',now());
 INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
 VALUES('${fid}','Synthetic review race','synthetic-review-race','その他','検証県','検証市','検証住所','draft');
 INSERT INTO public.bookings(facility_id,user_id,booking_date,start_time,end_time,customer_name,status,total_price,points_used)
 VALUES('${fid}','${actor}','2030-01-07','10:00','11:00','Synthetic','completed',1000,0); COMMIT;`);
 created=true;
 let result=await orderedRace('same-ip', insert(review,'192.0.2.140'), insert(other,'192.0.2.140'));
 assert.notEqual(result.code,0); assert.match(result.errors,/REVIEW_RECENT_DUPLICATE/);
 assert.equal(query(`SELECT count(*)=1 FROM public.facility_reviews WHERE facility_id='${fid}'`),'t');
 assert.equal(query(`SELECT count(*)=1 AND sum(points)=50 FROM public.user_points WHERE user_id='${actor}' AND reason LIKE '口コミポイント:%'`),'t');
 // The 24h limit also counts the account (20261023120000): the same member on
 // another network waits for the account lock, then sees the committed review.
 result=await orderedRace('same-account-distinct-ip', `SELECT public.lock_booking_account('${actor}')`, insert(other,'192.0.2.141'));
 assert.notEqual(result.code,0); assert.match(result.errors,/REVIEW_RECENT_DUPLICATE/);
 assert.equal(query(`SELECT count(*)=1 FROM public.facility_reviews WHERE facility_id='${fid}'`),'t');
 result=await orderedRace('distinct-ip-outside-window', `SELECT public.lock_booking_account('${actor}')`, insert(other,'192.0.2.141',"clock_timestamp()-interval '25 hours'"));
 assert.equal(result.code,0,result.errors);
 assert.equal(query(`SELECT count(*)=1 AND sum(points)=50 FROM public.user_points WHERE user_id='${actor}' AND reason LIKE '口コミポイント:%'`),'t');
 const edit = comment => `SELECT count(*) FROM public.edit_review_atomic('${actor}','${review}',jsonb_build_object('comment','${comment}','is_flagged',true,'flag_reason','${comment}'))`;
 result=await orderedRace('concurrent-edits', edit('First version'), edit('Second version'));
 assert.equal(result.code,0,result.errors); assert.equal(result.output,'1');
 assert.equal(query(`SELECT comment='Second version' AND is_flagged FROM public.facility_reviews WHERE id='${review}'`),'t');
 assert.equal(query(`SELECT count(*)=1 AND bool_and(report_reason='Second version') FROM public.moderation_queue WHERE content_id='${review}' AND status='pending'`),'t');
 console.log('Observed overlap: duplicate review rejected by IP and by account; a later review earns no duplicate points; concurrent edits preserve one current pending queue.');
}
try { await main(); } finally {
 for (const child of children) child.kill('SIGTERM');
 if(created) query(`BEGIN; DELETE FROM public.moderation_queue WHERE facility_id='${fid}'; DELETE FROM public.facility_reviews WHERE facility_id='${fid}'; DELETE FROM public.facility_profiles WHERE id='${fid}'; DELETE FROM auth.users WHERE id='${actor}'; COMMIT;`);
}
