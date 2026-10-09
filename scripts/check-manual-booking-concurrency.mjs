// Synthetic fixtures only. Observe real lock contention, not merely concurrent promises.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';

const localDockerShadow = process.argv[2] === '--local-docker-shadow';
const root = localDockerShadow ? undefined : process.argv[2];
const database = root ? (process.argv[3] || 'carelink_shadow') : 'carelink_shadow';
assert.ok(['carelink_shadow', 'carelink_manual_20261001', 'carelink_shadow_m09_20261001', 'carelink_shadow_m09_final_20261001'].includes(database));
const psql = localDockerShadow ? '/Users/kam/Projects/carelink-resume-evidence-20261008/runtime/pg-cli-bridge/psql' : 'psql';
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-d', database];
const runPrefix = `mb-${process.pid}-${Date.now().toString(36).slice(-5)}`;
const children = new Set();
let dbEnv;
let fixtureOwned = false;
const query = sql => {
  try { return execFileSync(psql, args, { env: dbEnv, input: sql, encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 }).trim(); }
  catch (error) {
    const text = String(error.stderr || '');
    const state = text.match(/ERROR:\s+([0-9A-Z]{5}):/);
    const contract = text.match(/ERROR:\s+P0001:\s+([A-Z][A-Z0-9_]+)\b/);
    const constraint = text.match(/violates unique constraint "([a-z_]+)"/);
    throw new Error(`fixture query failed${state ? ` SQLSTATE=${state[1]}` : ''}${contract ? ` contract=${contract[1]}` : ''}${constraint ? ` constraint=${constraint[1]}` : ''}`);
  }
};
function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
  timer.unref(); child.once('close', () => clearTimeout(timer));
}
function client(sql, name) {
  const child = spawn(psql, args, { env: { ...dbEnv, PGAPPNAME: name }, stdio: ['pipe','pipe','pipe'] });
  children.add(child); let output = '', errors = '';
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop(child); reject(new Error('fixture timeout')); }, 30000);
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 4096) stop(child); });
    child.stderr.on('data', chunk => { if(errors.length < 8192) errors += chunk; });
    child.once('error', () => { clearTimeout(timer); reject(new Error('fixture process failed')); });
    child.once('close', code => { children.delete(child); clearTimeout(timer);
      if (code === 0) resolve(output.trim()); else {
        const state = errors.match(/ERROR:\s+([0-9A-Z]{5}):/);
        const contractError = errors.match(/ERROR:\s+P0001:\s+([A-Z][A-Z0-9_]+)\b/);
        const cycle = Array.from(errors.matchAll(/Process (\d+) waits for ([A-Za-z]+) on transaction (\d+); blocked by process (\d+)/g))
          .map(row => `${row[1]} waits ${row[2]} tx${row[3]} blocked-by ${row[4]}`).join(', ');
        const functions = [...new Set(Array.from(errors.matchAll(/PL\/pgSQL function ([a-z_]+)\(/g)).map(row => row[1]))].join(',');
        const relations = [...new Set(Array.from(errors.matchAll(/in relation "([a-z_]+)"/g)).map(row => row[1]))].join(',');
        reject(new Error(`fixture query failed${state ? ` SQLSTATE=${state[1]}` : ''}${contractError ? ` contract=${contractError[1]}` : ''}${cycle ? ` cycle=${cycle}` : ''}${functions ? ` functions=${functions}` : ''}${relations ? ` relations=${relations}` : ''}`));
      } });
    child.stdin.on('error', () => stop(child));
  });
  if (sql !== undefined) child.stdin.end(sql);
  return { child, done, output: () => output };
}
async function contend(label, lock, calls, release = 'COMMIT;', firstBeforeRest = false) {
  console.log(`Observed-lock concurrency phase: ${label}`);
  const name = `${runPrefix}-${label}`;
  const coordinator = client(undefined, `${name}-coordinator`);
  let ended = false;
  const coordinated = coordinator.done.then(value => { ended = true; return value; }, () => { ended = true; return ''; });
  coordinator.child.stdin.write(`BEGIN; ${lock}; SELECT 'locked';\n`);
  const deadline = Date.now() + 20000;
  while (!coordinator.output().includes('locked\n')) {
    if (ended || Date.now() > deadline) { stop(coordinator.child); await coordinated; throw new Error('lock not acquired'); }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const workers = [];
  for (const [index,sql] of calls.entries()) {
    workers.push(client(sql,name).done);
    if (firstBeforeRest && index === 0) {
      // The remaining worker cannot win the account lock before the first
      // has reached its conflicting profile lock. Observe its actual blocker.
      while (query(`SELECT count(*) FROM pg_stat_activity a WHERE a.datname=current_database()
        AND a.application_name='${name}' AND a.state='active' AND a.wait_event_type='Lock'
        AND EXISTS(SELECT 1 FROM pg_stat_activity c WHERE c.application_name='${name}-coordinator'
          AND c.pid=ANY(pg_blocking_pids(a.pid)))`) !== '1') {
        if (Date.now() > deadline) throw new Error('overlap first worker not observed');
        await new Promise(resolve => setTimeout(resolve,20));
      }
      console.log(`First worker blocker observed before second spawn: ${label}`);
    }
  }
  coordinator.child.stdin.end(`DO $$ DECLARE deadline timestamptz := clock_timestamp()+interval '20 seconds'; BEGIN
    LOOP PERFORM pg_stat_clear_snapshot();
      EXIT WHEN (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()
        AND application_name='${name}' AND state='active' AND wait_event_type='Lock')=${calls.length};
      IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'overlap not observed'; END IF;
      PERFORM pg_sleep(0.02);
    END LOOP; END $$; SELECT 'overlap-observed'; ${release}`);
  const results = await Promise.allSettled(workers);
  assert.match(await coordinated, /overlap-observed/);
  assert.ok(results.every(row => row.status === 'fulfilled'),
    results.filter(row => row.status === 'rejected').map(row => row.reason.message).join('; '));
  return results.map(row => row.value);
}
const actor = 'd1000000-0000-4000-8000-000000000001';
const facility = 'd2000000-0000-4000-8000-000000000001';
const menu = 'd3000000-0000-4000-8000-000000000001';
const staff = 'd4000000-0000-4000-8000-000000000001';
const op = n => `d5000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function call(n, day) {
  const input = JSON.stringify({ facility_id:facility, staff_id:staff, menu_ids:[menu], booking_date:`2030-01-${day}`,
    start_time:'10:00', end_time:'11:00', customer_name:'Synthetic', email:'manual-fixture@example.invalid', phone:null, note:null });
  return `SET ROLE service_role; CREATE FUNCTION pg_temp.attempt() RETURNS text LANGUAGE plpgsql AS $$ BEGIN
    RETURN public.create_manual_booking_atomic('${actor}','${op(n)}','${input}'::jsonb)->>'booking_id';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'BOOKING_CONFLICT%' THEN RETURN 'conflict'; END IF; RAISE;
    WHEN insufficient_privilege THEN RETURN 'forbidden'; END $$; SELECT pg_temp.attempt();`;
}
async function main() {
  if (process.env.PGSERVICE || process.env.PGSERVICEFILE || process.env.PGHOSTADDR) throw new Error('alternate connection refused');
  if (localDockerShadow) {
    assert.equal(process.argv.length, 3);
    assert.equal(realpathSync(psql), psql);
    dbEnv = { PATH:process.env.PATH, PGSSLMODE:'disable' };
    assert.equal(query("SELECT current_setting('server_version_num')::int BETWEEN 170000 AND 179999"), 't');
  } else if (root) {
    assert.match(root, /^\/tmp\/carelink-pg17-postgis\.[a-zA-Z0-9]+$/);
    const info = statSync(root); assert.ok(info.isDirectory());
    assert.equal(info.uid, process.getuid()); assert.equal(info.mode & 0o777, 0o700);
    dbEnv = { PATH:process.env.PATH, PGHOST:`${root}/socket`, PGPORT:'56419',
      PGUSER:process.env.USER || 'kanbararyousuke', PGSSLMODE:'disable' };
    assert.equal(query('SHOW listen_addresses'), '');
    assert.equal(realpathSync(query('SHOW data_directory')), realpathSync(`${root}/data`));
  } else {
    assert.equal(process.env.GITHUB_ACTIONS, 'true'); assert.equal(process.env.CI, 'true');
    assert.ok(['localhost','127.0.0.1'].includes(process.env.PGHOST));
    assert.equal(process.env.PGPORT,'5432'); assert.equal(process.env.PGUSER,'postgres'); assert.ok(process.env.PGPASSWORD);
    dbEnv = { PATH:process.env.PATH, PGHOST:'127.0.0.1', PGPORT:'5432', PGUSER:'postgres',
      PGPASSWORD:process.env.PGPASSWORD, PGSSLMODE:'disable' };
  }
  assert.equal(query('SELECT current_database()'), database);
  assert.equal(query("SELECT to_regprocedure('public.create_manual_booking_atomic(uuid,uuid,jsonb)') IS NOT NULL"), 't');
  assert.equal(query(`SELECT count(*) FROM public.facility_profiles WHERE id IN ('${facility}',
    'd2000000-0000-4000-8000-000000000003','d2000000-0000-4000-8000-000000000005','d2000000-0000-4000-8000-000000000006')`),'0');
  assert.equal(query(`SELECT count(*) FROM auth.users WHERE id IN ('${actor}',
    'd1000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000005')`),'0');
  assert.equal(query("SELECT count(*) FROM public.booking_adjust_operations WHERE operation_id='d6000000-0000-4000-8000-000000000001'"),'0');
  query(`BEGIN; INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${actor}','manual-owner-fixture@example.invalid',now());
    INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
      VALUES('${facility}','Synthetic manual race','synthetic-manual-race','その他','検証県','検証市','検証住所','draft');
    INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('${actor}','${facility}','owner');
    INSERT INTO public.facility_menus(id,facility_id,category,name,price,duration_minutes,is_published)
      VALUES('${menu}','${facility}','synthetic','Synthetic menu',1000,60,false);
    INSERT INTO public.staff_profiles(id,facility_id,name,slug,nomination_fee)
      VALUES('${staff}','${facility}','Synthetic staff','synthetic-manual-race-staff',0); COMMIT;`);
  fixtureOwned = true;
  const twenty = fn => Array.from({ length:20 }, (_,n) => fn(n));
  const replay = await contend('same-operation',
    `SELECT pg_advisory_xact_lock(hashtextextended('manual-booking:${op(1)}',0))`, twenty(() => call(1,'07')));
  assert.equal(new Set(replay).size, 1); assert.match(replay[0], /^[a-f0-9-]{36}$/);
  assert.equal(query(`SELECT count(*) FROM public.manual_booking_operations WHERE facility_id='${facility}'`), '1');
  assert.equal(query(`SELECT count(*) FROM public.webhook_retry_queue WHERE id='${op(1)}'`), '1');
  const capacity = await contend('distinct-operations',
    `SELECT pg_advisory_xact_lock(('x'||left(md5('${facility}'||'2030-01-08'),16))::bit(64)::bigint)`,
    twenty(n => call(n+2,'08')));
  assert.equal(capacity.filter(value => value === 'conflict').length, 19);
  assert.equal(query(`SELECT count(*) FROM public.bookings WHERE facility_id='${facility}'`), '2');
  assert.equal(query(`SELECT count(*) FROM public.manual_booking_operations WHERE facility_id='${facility}'`), '2');
  assert.equal(query(`SELECT count(*) FROM public.webhook_retry_queue WHERE facility_id='${facility}'`), '2');
  const revoked = await contend('role-revoked',
    `SELECT id FROM public.facility_members WHERE user_id='${actor}' AND facility_id='${facility}' FOR UPDATE`,
    twenty(n => call(n+30,'09')),
    `UPDATE public.facility_members SET role='staff' WHERE user_id='${actor}' AND facility_id='${facility}'; COMMIT;`);
  assert.ok(revoked.every(value => value === 'forbidden'));
  assert.equal(query(`SELECT count(*) FROM public.bookings WHERE facility_id='${facility}'`), '2');
  query(`UPDATE public.facility_members SET role='owner' WHERE user_id='${actor}' AND facility_id='${facility}'`);
  const publicationCall = `SET ROLE service_role; CREATE FUNCTION pg_temp.attempt() RETURNS text LANGUAGE plpgsql AS $$ BEGIN
    PERFORM public.set_facilities_publication_atomic('${actor}',ARRAY['${facility}'::uuid],true); RETURN 'published';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM='FACILITY_PERMISSION_REVOKED' THEN RETURN 'forbidden'; END IF; RAISE;
    END $$; SELECT pg_temp.attempt();`;
  const publication = await contend('publication-revoked',
    `SELECT id FROM public.facility_members WHERE user_id='${actor}' AND facility_id='${facility}' FOR UPDATE`,
    twenty(() => publicationCall),
    `UPDATE public.facility_members SET role='staff' WHERE user_id='${actor}' AND facility_id='${facility}'; COMMIT;`);
  assert.ok(publication.every(value => value === 'forbidden'));
  assert.equal(query(`SELECT status FROM public.facility_profiles WHERE id='${facility}'`),'suspended');
  query(`UPDATE public.facility_members SET role='owner' WHERE user_id='${actor}' AND facility_id='${facility}'`);
  query(`SET ROLE service_role; SELECT public.set_facilities_publication_atomic('${actor}',ARRAY['${facility}'::uuid],true)`);
  assert.equal(query(`SELECT status FROM public.facility_profiles WHERE id='${facility}'`),'published');
  const settingsCall = `SET ROLE service_role; CREATE FUNCTION pg_temp.attempt() RETURNS text LANGUAGE plpgsql AS $$ BEGIN
    PERFORM public.update_facility_settings_atomic('${actor}','${facility}','{"name":"stale settings"}'::jsonb); RETURN 'saved';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM='FACILITY_PERMISSION_REVOKED' THEN RETURN 'forbidden'; END IF; RAISE;
    END $$; SELECT pg_temp.attempt();`;
  const settings = await contend('settings-revoked',
    `SELECT id FROM public.facility_members WHERE user_id='${actor}' AND facility_id='${facility}' FOR UPDATE`,
    twenty(() => settingsCall),
    `UPDATE public.facility_members SET role='staff' WHERE user_id='${actor}' AND facility_id='${facility}'; COMMIT;`);
  assert.ok(settings.every(value => value === 'forbidden'));
  assert.equal(query(`SELECT name FROM public.facility_profiles WHERE id='${facility}'`),'Synthetic manual race');
  query(`UPDATE public.facility_members SET role='owner' WHERE user_id='${actor}' AND facility_id='${facility}'`);
  const booking = replay[0];
  const revision = query(`SELECT updated_at FROM public.bookings WHERE id='${booking}'`);
  const envelope = JSON.stringify({ from:'sender@example.invalid',to:'manual-fixture@example.invalid',
    subject:'Synthetic only',html:'<p>concurrency fixture</p>' });
  const eventCall = next => `SET ROLE service_role; CREATE FUNCTION pg_temp.attempt() RETURNS text LANGUAGE plpgsql AS $$ BEGIN
    RETURN (SELECT operation_id::text FROM public.save_booking_email_event_atomic('${actor}','${booking}',
      'confirmed','${revision}',${next === null ? 'NULL' : `'${next}'`},'${envelope}'::jsonb,'d6000000-0000-4000-8000-000000000001'));
    EXCEPTION WHEN raise_exception THEN IF SQLERRM='BOOKING_REVISION_CONFLICT' THEN RETURN 'conflict'; END IF; RAISE;
    END $$; SELECT pg_temp.attempt();`;
  const adjustment = await contend('same-adjustment',`SELECT id FROM public.bookings WHERE id='${booking}' FOR UPDATE`,
    twenty(() => eventCall(null)));
  assert.equal(new Set(adjustment).size,1); assert.match(adjustment[0],/^[a-f0-9-]{36}$/);
  assert.equal(query(`SELECT count(*) FROM public.webhook_retry_queue WHERE booking_event_id='${booking}' AND booking_event_kind='adjust'`),'1');
  const status = await contend('same-status',`SELECT id FROM public.bookings WHERE id='${booking}' FOR UPDATE`,
    twenty(() => eventCall('completed')));
  assert.equal(status.filter(value => value === 'conflict').length,19);
  assert.equal(query(`SELECT count(*) FROM public.webhook_retry_queue WHERE booking_event_id='${booking}' AND booking_event_kind='status'`),'1');
  assert.equal(query(`SELECT count(*) FROM public.customer_visits WHERE booking_id='${booking}'`),'1');
  const departedFacility='d2000000-0000-4000-8000-000000000003';
  const owners=['d1000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000004'];
  query(`BEGIN; INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
    ('${owners[0]}','departing-one@example.invalid',now()),('${owners[1]}','departing-two@example.invalid',now());
    INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
      VALUES('${departedFacility}','Synthetic departed','synthetic-departed','その他','検証県','検証市','検証住所','published');
    INSERT INTO public.facility_members(user_id,facility_id,role) VALUES
      ('${owners[0]}','${departedFacility}','owner'),('${owners[1]}','${departedFacility}','owner'),
      ('${actor}','${departedFacility}','admin'); COMMIT;`);
  await contend('two-owner-departures',`SELECT id FROM public.facility_profiles WHERE id='${departedFacility}' FOR UPDATE`,
    owners.map(owner => `DELETE FROM auth.users WHERE id='${owner}'; SELECT 'deleted';`));
  assert.equal(query(`SELECT count(*) FROM public.facility_members WHERE facility_id='${departedFacility}' AND role='owner'`),'0');
  assert.equal(query(`SELECT status FROM public.facility_profiles WHERE id='${departedFacility}'`),'suspended');
  assert.equal(query(`SET ROLE service_role; CREATE FUNCTION pg_temp.attempt() RETURNS text LANGUAGE plpgsql AS $$ BEGIN
    PERFORM public.set_facilities_publication_atomic('${actor}',ARRAY['${departedFacility}'::uuid],true); RETURN 'published';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM='FACILITY_OWNER_REQUIRED' THEN RETURN 'ownerless'; END IF; RAISE;
    END $$; SELECT pg_temp.attempt();`),'ownerless');
  const retiringActor='d1000000-0000-4000-8000-000000000005';
  const retiringFacility='d2000000-0000-4000-8000-000000000005';
  const retiringMenu='d3000000-0000-4000-8000-000000000005';
  const retiringStaff='d4000000-0000-4000-8000-000000000005';
  query(`BEGIN; INSERT INTO auth.users(id,email,email_confirmed_at)
    VALUES('${retiringActor}','retirement-race@example.invalid',now());
    INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
      VALUES('${retiringFacility}','Synthetic manual retirement race','synthetic-manual-retirement-race','その他','検証県','検証市','検証住所','draft');
    INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('${retiringActor}','${retiringFacility}','owner');
    INSERT INTO public.facility_menus(id,facility_id,category,name,price,duration_minutes,is_published)
      VALUES('${retiringMenu}','${retiringFacility}','synthetic','Synthetic retirement menu',1000,60,false);
    INSERT INTO public.staff_profiles(id,facility_id,name,slug,nomination_fee)
      VALUES('${retiringStaff}','${retiringFacility}','Synthetic manual retiring staff','synthetic-manual-retiring-staff',0); COMMIT;`);
  assert.equal(query(`SELECT count(*) FROM public.bookings WHERE facility_id='${retiringFacility}'`),'0');
  const retirementInput=JSON.stringify({facility_id:retiringFacility,staff_id:retiringStaff,menu_ids:[retiringMenu],
    booking_date:'2030-01-10',start_time:'10:00',end_time:'11:00',customer_name:'Synthetic',email:null,phone:null,note:null});
  const retirement = await contend('reservation-after-retirement-count',
    // Match the actual manual writer: it protects its actor before any
    // membership/profile lock. A synthetic member-first barrier creates a
    // cycle with Auth DELETE that no longer represents this RPC's order.
    `SELECT public.lock_booking_account('${retiringActor}');
     SELECT id FROM public.facility_members WHERE user_id='${retiringActor}' FOR SHARE;
     SELECT id FROM public.facility_profiles WHERE id='${retiringFacility}' FOR SHARE`,
    [`CREATE FUNCTION pg_temp.attempt() RETURNS text LANGUAGE plpgsql AS $$ BEGIN
      DELETE FROM auth.users WHERE id='${retiringActor}'; RETURN 'deleted';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM='ACCOUNT_ACTIVE_BOOKINGS_PREVENT_DELETION' THEN RETURN 'active-reservation'; END IF; RAISE;
      END $$; SELECT pg_temp.attempt();`],
    `SET LOCAL ROLE service_role; SELECT public.create_manual_booking_atomic('${retiringActor}','${op(90)}','${retirementInput}'::jsonb); COMMIT;`);
  assert.deepEqual(retirement,['active-reservation']);
  assert.equal(query(`SELECT count(*) FROM auth.users WHERE id='${retiringActor}'`),'1');
  assert.equal(query(`SELECT count(*) FROM public.facility_members WHERE user_id='${retiringActor}' AND role='owner'`),'1');
  assert.equal(query(`SELECT count(*) FROM public.bookings WHERE facility_id='${retiringFacility}' AND status='confirmed'`),'1');
  query(`UPDATE public.bookings SET status='cancelled' WHERE facility_id='${retiringFacility}';
    DELETE FROM auth.users WHERE id='${retiringActor}';`);
  assert.equal(query(`SELECT status FROM public.facility_profiles WHERE id='${retiringFacility}'`),'suspended');
  // The owner is also a customer: Auth KEY SHARE must precede the profile
  // SHARE, otherwise deletion and the booking FK can form a deadlock cycle.
  query(`BEGIN; INSERT INTO auth.users(id,email,email_confirmed_at)
    VALUES('${retiringActor}','retirement-race@example.invalid',now());
    INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('${retiringActor}','${retiringFacility}','owner');
    UPDATE public.facility_profiles SET status='published',business_hours=
      (SELECT jsonb_object_agg(n,jsonb_build_object('open','09:00','close','19:00','is_holiday',false))
        FROM unnest(ARRAY['sun','mon','tue','wed','thu','fri','sat']) n)
      WHERE id='${retiringFacility}';
    UPDATE public.facility_menus SET is_published=true WHERE id='${retiringMenu}';
    INSERT INTO public.facility_photos(facility_id,photo_url,photo_type)
      VALUES('${retiringFacility}','https://example.invalid/synthetic.jpg','interior');
    INSERT INTO public.staff_schedules(staff_id,day_of_week,start_time,end_time)
      VALUES('${retiringStaff}',4,'09:00','19:00'); COMMIT;`);
  const selfBooking=await contend('online-owner-versus-retirement',
    `SELECT id FROM auth.users WHERE id='${retiringActor}' FOR KEY SHARE;
     SELECT id FROM public.facility_profiles WHERE id='${retiringFacility}' FOR UPDATE`,[
      `RESET ROLE; SELECT public.create_online_booking_atomic('${retiringFacility}','${retiringStaff}','${retiringActor}',
        '${retiringMenu}',NULL,'2030-01-10','11:00','12:00','Synthetic',NULL,NULL,NULL,1000,0,'confirmed',ARRAY['${retiringMenu}'::uuid]);`,
      `CREATE FUNCTION pg_temp.attempt() RETURNS text LANGUAGE plpgsql AS $$ BEGIN
        DELETE FROM auth.users WHERE id='${retiringActor}'; RETURN 'deleted'; EXCEPTION WHEN raise_exception THEN
        IF SQLERRM='ACCOUNT_ACTIVE_BOOKINGS_PREVENT_DELETION' THEN RETURN 'active-reservation'; END IF; RAISE;
        END $$; SELECT pg_temp.attempt();`,
    ],'COMMIT;',true);
  assert.match(selfBooking[0],/^[a-f0-9-]{36}$/);
  assert.equal(selfBooking[1],'active-reservation');
  assert.equal(query(`SELECT count(*) FROM public.bookings WHERE facility_id='${retiringFacility}' AND user_id='${retiringActor}' AND status='confirmed'`),'1');
  query(`UPDATE public.bookings SET status='cancelled' WHERE facility_id='${retiringFacility}'`);
  const deletionFirst=await contend('retirement-before-online',`SELECT id FROM auth.users WHERE id='${retiringActor}' FOR UPDATE`,[
    `RESET ROLE; CREATE FUNCTION pg_temp.attempt() RETURNS text LANGUAGE plpgsql AS $$ BEGIN
      PERFORM public.create_online_booking_atomic('${retiringFacility}','${retiringStaff}','${retiringActor}',
        '${retiringMenu}',NULL,'2030-01-10','12:00','13:00','Synthetic',NULL,NULL,NULL,1000,0,'confirmed',ARRAY['${retiringMenu}'::uuid]);
      RETURN 'booked'; EXCEPTION WHEN raise_exception THEN
      IF SQLERRM='BOOKING_ACCOUNT_UNAVAILABLE' THEN RETURN 'account-deleted'; END IF; RAISE;
      END $$; SELECT pg_temp.attempt();`,
  ],`DELETE FROM auth.users WHERE id='${retiringActor}'; COMMIT;`);
  assert.deepEqual(deletionFirst,['account-deleted']);
  assert.equal(query(`SELECT count(*) FROM public.bookings WHERE facility_id='${retiringFacility}' AND status='confirmed'`),'0');
  const deletedFacility='d2000000-0000-4000-8000-000000000006';
  const deletedMenu='d3000000-0000-4000-8000-000000000006';
  const deletedStaff='d4000000-0000-4000-8000-000000000006';
  query(`BEGIN; INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
    VALUES('${deletedFacility}','Synthetic manual parent race','synthetic-manual-parent-race','その他','検証県','検証市','検証住所','draft');
    -- This actor already owns the main fixture. Existing one-owner-per-user
    -- policy permits an additional admin membership, not a second owner row.
    INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('${actor}','${deletedFacility}','admin');
    INSERT INTO public.facility_menus(id,facility_id,category,name,price,duration_minutes,is_published)
    VALUES('${deletedMenu}','${deletedFacility}','synthetic','Synthetic parent menu',1000,60,false);
    INSERT INTO public.staff_profiles(id,facility_id,name,slug,nomination_fee)
    VALUES('${deletedStaff}','${deletedFacility}','Synthetic parent staff','synthetic-parent-staff',0); COMMIT;`);
  const deletedInput=JSON.stringify({facility_id:deletedFacility,staff_id:deletedStaff,menu_ids:[deletedMenu],booking_date:'2030-01-11',
    start_time:'10:00',end_time:'11:00',customer_name:'Synthetic parent race',email:null,phone:null,note:null});
  const deleted=await contend('parent-delete-before-manual',
    `SELECT id FROM public.facility_profiles WHERE id='${deletedFacility}' FOR UPDATE`,
    twenty(n=>`SET ROLE service_role; CREATE FUNCTION pg_temp.attempt() RETURNS text LANGUAGE plpgsql AS $$ BEGIN
      RETURN public.create_manual_booking_atomic('${actor}','${op(120+n)}','${deletedInput}'::jsonb)->>'booking_id';
      EXCEPTION WHEN insufficient_privilege THEN RETURN 'forbidden'; END $$; SELECT pg_temp.attempt();`),
    `DELETE FROM public.facility_profiles WHERE id='${deletedFacility}'; COMMIT;`);
  assert.ok(deleted.every(value=>value==='forbidden'));
  assert.equal(query(`SELECT count(*) FROM public.bookings WHERE facility_id='${deletedFacility}'`),'0');
  assert.equal(query(`SELECT count(*) FROM public.manual_booking_operations WHERE facility_id='${deletedFacility}'`),'0');
  console.log('Reservation/publication concurrency passed: 8 x 20 observed lock-waiting clients plus two simultaneous Auth owner departures; manual replay/capacity/revocation and parent deletion, publication/settings revocation and owner restoration, adjustment event reuse, state/outbox/visit CAS, ownerless listing suspension. Synthetic disposable DB only.');
}
main().catch(error => {
  // Never print psql's raw query/arguments. Assert labels and our bounded
  // fixture-process failures are safe diagnostics for this synthetic runner.
  console.error('Manual reservation concurrency contract failed; no production access authorized.', {
    failure: error instanceof assert.AssertionError ? error.message :
      error instanceof Error && /^(fixture |lock |overlap)/.test(error.message) ? error.message : 'fixture preflight/query failed',
  }); process.exitCode = 1;
})
  .finally(() => {
    for (const child of children) stop(child);
    if (!fixtureOwned) return;
    query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database()
      AND application_name LIKE '${runPrefix}-%' AND pid<>pg_backend_pid()`);
    query(`BEGIN; DELETE FROM public.booking_adjust_operations WHERE operation_id='d6000000-0000-4000-8000-000000000001' AND actor_id='${actor}';
      DELETE FROM public.webhook_retry_queue WHERE facility_id IN ('${facility}',
      'd2000000-0000-4000-8000-000000000003','d2000000-0000-4000-8000-000000000005','d2000000-0000-4000-8000-000000000006');
      DELETE FROM public.manual_booking_operations WHERE facility_id IN ('${facility}',
      'd2000000-0000-4000-8000-000000000003','d2000000-0000-4000-8000-000000000005','d2000000-0000-4000-8000-000000000006');
      DELETE FROM public.bookings WHERE facility_id IN ('${facility}',
      'd2000000-0000-4000-8000-000000000003','d2000000-0000-4000-8000-000000000005','d2000000-0000-4000-8000-000000000006');
      DELETE FROM public.facility_profiles WHERE id IN ('${facility}',
      'd2000000-0000-4000-8000-000000000003','d2000000-0000-4000-8000-000000000005','d2000000-0000-4000-8000-000000000006');
      DELETE FROM auth.users WHERE id IN ('${actor}',
      'd1000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-000000000005'); COMMIT;`);
  });
