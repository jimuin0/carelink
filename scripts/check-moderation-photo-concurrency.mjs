// Synthetic-only PG17 race contracts. No HTTP, Storage, provider or production I/O.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
const localDocker = process.argv[2] === '--local-docker';
assert.ok(process.argv.length <= 3 && (!process.argv[2] || localDocker), 'unsupported runner mode');
if (process.env.PGSERVICE || process.env.PGSERVICEFILE || process.env.PGHOSTADDR) throw new Error('alternate connection refused');
let binary, args, dbEnv;
if (localDocker) {
  assert.match(process.env.DOCKER_HOST || '', /^unix:\/\/\/Users\/kam\/\.carelink-vm-20261008\/\.docker\/run\/docker\.sock$/);
  binary = 'docker'; args = ['exec', '-i', 'supabase_db_carelink', 'psql', '-U', 'postgres', '-d', 'postgres'];
  dbEnv = { PATH: process.env.PATH, DOCKER_HOST: process.env.DOCKER_HOST, DOCKER_CONFIG: process.env.DOCKER_CONFIG };
} else {
  assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.CI, 'true');
  assert.ok(['localhost', '127.0.0.1'].includes(process.env.PGHOST)); assert.equal(process.env.PGPORT, '5432');
  assert.equal(process.env.PGUSER, 'postgres'); assert.ok(process.env.PGPASSWORD);
  binary = 'psql'; args = ['-d', 'carelink_shadow'];
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
  const workerName = `modphoto-${label}`;
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
const actor = 'f8600000-0000-4000-8000-000000000001';
const fid = 'f8610000-0000-4000-8000-000000000001';
const photo = 'f8620000-0000-4000-8000-000000000001';
const otherPhoto = 'f8620000-0000-4000-8000-000000000002';
const review = 'f8630000-0000-4000-8000-000000000001';
const queue = 'f8640000-0000-4000-8000-000000000001';
const setMain = pid => `SELECT count(*) FROM public.set_facility_main_photo_atomic('${actor}','${fid}','${pid}')`;
const remove = pid => `SELECT count(*) FROM public.delete_facility_photo_atomic('${actor}','${fid}','${pid}')`;
const moderate = decision => `SELECT replayed FROM public.moderate_content_atomic('${actor}','${queue}','pending','${decision}',NULL)`;
let created = false;
async function main() {
  assert.equal(query('SELECT current_database()'), localDocker ? 'postgres' : 'carelink_shadow');
  assert.equal(query("SELECT current_setting('server_version_num')::integer BETWEEN 170000 AND 179999"), 't');
  assert.equal(query(`SELECT EXISTS(SELECT 1 FROM auth.users WHERE id='${actor}') OR EXISTS(SELECT 1 FROM public.facility_profiles WHERE id='${fid}')`), 'f');
  query(`BEGIN;
    INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${actor}','synthetic-modphoto-race@example.invalid',now());
    UPDATE public.profiles SET is_platform_admin=true WHERE id='${actor}';
    INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
      VALUES('${fid}','Synthetic photo concurrency','synthetic-modphoto-concurrency','その他','合成県','合成市','合成住所','draft');
    INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('${actor}','${fid}','owner');
    INSERT INTO public.facility_reviews(id,facility_id,reviewer_name,rating,reviewer_ip)
      VALUES('${review}','${fid}','Synthetic concurrency',4,'127.0.0.1');
    INSERT INTO public.moderation_queue(id,content_type,content_id,facility_id) VALUES('${queue}','review','${review}','${fid}');
    COMMIT;`);
  created = true;
  const addPhoto = pid => query(`INSERT INTO public.facility_photos(id,facility_id,photo_url,photo_type) VALUES('${pid}','${fid}','https://example.invalid/${pid}.png','main');`);
  addPhoto(photo);
  let race = await orderedRace('set-before-delete', setMain(photo), remove(photo));
  assert.equal(race.code, 0, race.errors); assert.equal(race.output, '1');
  assert.equal(query(`SELECT main_photo_url IS NULL AND NOT EXISTS(SELECT 1 FROM public.facility_photos WHERE id='${photo}') FROM public.facility_profiles WHERE id='${fid}'`), 't');
  addPhoto(photo); query(`SET ROLE service_role; ${setMain(photo)};`);
  race = await orderedRace('delete-before-set', remove(photo), setMain(photo));
  assert.equal(race.code, 0, race.errors); assert.equal(race.output, '0');
  assert.equal(query(`SELECT main_photo_url IS NULL FROM public.facility_profiles WHERE id='${fid}'`), 't');
  addPhoto(photo); addPhoto(otherPhoto);
  race = await orderedRace('new-main-old-delete', setMain(otherPhoto), remove(photo));
  assert.equal(race.code, 0, race.errors); assert.equal(race.output, '1');
  assert.equal(query(`SELECT main_photo_url='https://example.invalid/${otherPhoto}.png' FROM public.facility_profiles WHERE id='${fid}'`), 't');
  addPhoto(photo);
  query(`UPDATE public.facility_photos SET photo_url='https://example.invalid/${otherPhoto}.png' WHERE id='${photo}';`);
  race = await orderedRace('duplicate-url-two-server-deletes', `DELETE FROM public.facility_photos WHERE id='${photo}'`, `WITH removed AS (DELETE FROM public.facility_photos WHERE id='${otherPhoto}' RETURNING id) SELECT count(*) FROM removed`);
  assert.equal(race.code, 0, race.errors); assert.equal(race.output, '1');
  assert.equal(query(`SELECT main_photo_url IS NULL AND NOT EXISTS(SELECT 1 FROM public.facility_photos WHERE facility_id='${fid}') FROM public.facility_profiles WHERE id='${fid}'`), 't');
  race = await orderedRace('same-decision-replay', moderate('rejected'), moderate('rejected'));
  assert.equal(race.code, 0, race.errors); assert.equal(race.output, 't');
  assert.equal(query(`SELECT q.status='rejected' AND r.status='hidden' AND q.reviewed_by='${actor}' FROM public.moderation_queue q JOIN public.facility_reviews r ON r.id=q.content_id WHERE q.id='${queue}'`), 't');
  query(`UPDATE public.moderation_queue SET status='pending',review_note=NULL,reviewed_at=NULL,reviewed_by=NULL WHERE id='${queue}';
    UPDATE public.facility_reviews SET status='published',is_flagged=false WHERE id='${review}';`);
  race = await orderedRace('different-decision-conflict', moderate('approved'), moderate('rejected'));
  assert.notEqual(race.code, 0); assert.match(race.errors, /MODERATION_REVISION_CONFLICT/);
  assert.equal(query(`SELECT q.status='approved' AND r.status='published' FROM public.moderation_queue q JOIN public.facility_reviews r ON r.id=q.content_id WHERE q.id='${queue}'`), 't');
  race = await orderedRace('permission-revocation', `UPDATE public.profiles SET is_platform_admin=false WHERE id='${actor}'`, moderate('approved'));
  assert.notEqual(race.code, 0); assert.match(race.errors, /MODERATION_PERMISSION_REVOKED/);
  query(`UPDATE public.profiles SET is_platform_admin=true WHERE id='${actor}';
    UPDATE public.moderation_queue SET status='pending',review_note=NULL,reviewed_at=NULL,reviewed_by=NULL WHERE id='${queue}';`);
  race = await orderedRace('moderation-before-parent-cascade', moderate('rejected'), `WITH removed AS (DELETE FROM public.facility_profiles WHERE id='${fid}' RETURNING id) SELECT count(*) FROM removed`);
  assert.equal(race.code, 0, race.errors); assert.equal(race.output, '1');
  assert.equal(query(`SELECT EXISTS(SELECT 1 FROM public.facility_reviews WHERE id='${review}') OR EXISTS(SELECT 1 FROM public.moderation_queue WHERE id='${queue}')`), 'f');
  query(`BEGIN; INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
    VALUES('${fid}','Synthetic cascade order','synthetic-modphoto-concurrency','その他','合成県','合成市','合成住所','draft');
    INSERT INTO public.facility_reviews(id,facility_id,reviewer_name,rating,reviewer_ip) VALUES('${review}','${fid}','Synthetic cascade',4,'127.0.0.1');
    INSERT INTO public.moderation_queue(id,content_type,content_id,facility_id) VALUES('${queue}','review','${review}','${fid}'); COMMIT;`);
  race = await orderedRace('parent-cascade-before-moderation', `DELETE FROM public.facility_profiles WHERE id='${fid}'`, `SELECT count(*) FROM public.moderate_content_atomic('${actor}','${queue}','pending','rejected',NULL)`);
  assert.equal(race.code, 0, race.errors); assert.equal(race.output, '0');
  assert.equal(query(`SELECT EXISTS(SELECT 1 FROM public.facility_profiles WHERE id='${fid}') OR EXISTS(SELECT 1 FROM public.moderation_queue WHERE id='${queue}')`), 'f');
  console.log('Moderation/photo PG17 concurrency passed: 9 observed overlaps, both set/delete orders, new-main preservation, duplicate-URL server deletion, exact replay, conflicting decision CAS, authority revocation and both parent-cascade/moderation orders. Synthetic local/shadow only.');
}
try { await main(); } finally {
  for (const child of children) child.kill('SIGTERM');
  if (created) {
    query(`BEGIN; DELETE FROM public.facility_profiles WHERE id='${fid}'; DELETE FROM auth.users WHERE id='${actor}'; COMMIT;`);
    assert.equal(query(`SELECT EXISTS(SELECT 1 FROM public.facility_profiles WHERE id='${fid}') OR EXISTS(SELECT 1 FROM auth.users WHERE id='${actor}')`), 'f');
  }
}
