// Synthetic PG17 transactions only. No provider calls, real recipients or business cleanup.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
const local = process.argv[2] === '--local-docker';
const database = local ? 'postgres' : 'carelink_shadow';
const prefix = `coupon-race-${Date.now().toString(36)}-${process.pid}`;
let executable; let argumentsFor; let environment;
if (local) {
  assert.equal(process.argv.length, 3);
  assert.match(process.env.DOCKER_HOST || '', /^unix:\/\/.+\/\.docker\/run\/docker\.sock$/);
  executable = 'docker'; environment = process.env;
  argumentsFor = name => ['exec','-i','-e',`PGAPPNAME=${name}`,'supabase_db_carelink','psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1','-d',database];
} else {
  assert.equal(process.argv.length, 2);
  assert.equal(process.env.GITHUB_ACTIONS,'true'); assert.equal(process.env.CI,'true');
  assert.ok(['localhost','127.0.0.1'].includes(process.env.PGHOST));
  assert.equal(process.env.PGPORT,'5432'); assert.equal(process.env.PGUSER,'postgres'); assert.ok(process.env.PGPASSWORD);
  assert.ok(!process.env.PGSERVICE && !process.env.PGSERVICEFILE && !process.env.PGHOSTADDR);
  executable='psql'; environment={ PATH:process.env.PATH,PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGPASSWORD:process.env.PGPASSWORD,PGSSLMODE:'disable' };
  argumentsFor = name => ['-X','-qAt','-v','ON_ERROR_STOP=1','-d',database,'-c',`SET application_name='${name}';`,'-f','-'];
}
const children = new Set();
const query = sql => execFileSync(executable, argumentsFor(`${prefix}-query`), {
  env:environment,input:sql,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe'],maxBuffer:1024*1024,
}).trim();
function client(sql,name) {
  const child=spawn(executable,argumentsFor(name),{env:environment,stdio:['pipe','pipe','pipe']});
  children.add(child); let output=''; let errors='';
  const done=new Promise((resolve,reject) => {
    const timer=setTimeout(()=>{ child.kill('SIGTERM'); reject(new Error('coupon fixture timeout')); },30000);
    child.stdout.on('data',chunk=>{ output+=chunk; if(output.length>16384)child.kill('SIGTERM'); });
    child.stderr.on('data',chunk=>{ errors=(errors+chunk).slice(0,2048); });
    child.on('error',()=>{ clearTimeout(timer); reject(new Error('coupon fixture client failed')); });
    child.on('close',code=>{ clearTimeout(timer); children.delete(child);
      if(code===0)resolve(output.trim()); else reject(new Error(`coupon fixture query failed: ${errors.split('\n').find(line=>line.includes('ERROR:')) || 'client exit'}`)); });
    child.stdin.on('error',()=>child.kill('SIGTERM'));
  });
  // Attach a rejection handler immediately while the coordinator observes waits.
  done.catch(()=>undefined);
  if(sql!==undefined)child.stdin.end(sql); return {child,done,output:()=>output};
}
async function contend(label,lock,calls) {
  const name=`${prefix}-${label}`; const coordinator=client(undefined,`${name}-coord`);
  let ended=false; const coordinated=coordinator.done.then(value=>{ended=true;return value;},error=>{ended=true;throw error;});
  coordinated.catch(()=>undefined);
  coordinator.child.stdin.write(`BEGIN; ${lock}; SELECT 'locked';\n`);
  const deadline=Date.now()+20000;
  while(!coordinator.output().includes('locked\n')) {
    if(ended || Date.now()>deadline)throw new Error('coupon fixture lock unavailable');
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  const workers=calls.map(sql=>client(sql,name).done);
  coordinator.child.stdin.end(`DO $$ DECLARE deadline timestamptz:=clock_timestamp()+interval '20 seconds'; BEGIN LOOP
    PERFORM pg_stat_clear_snapshot(); EXIT WHEN (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='${name}' AND state='active' AND wait_event_type='Lock')=${calls.length};
    IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'coupon concurrency overlap not observed'; END IF; PERFORM pg_sleep(0.02); END LOOP; END $$;
    SELECT 'overlap-observed'; COMMIT;`);
  const results=await Promise.allSettled(workers);
  for(const result of results)if(result.status==='rejected')throw result.reason;
  assert.match(await coordinated,/overlap-observed/);
  console.log(`${label}: actual concurrent PostgreSQL lock wait observed`);
  return results.map(result=>result.value);
}
const facility='ec010000-0000-4000-8000-000000000001';
const freshEmail='coupon-race-new@example.invalid';
// Seeded in the OLD schema by coupon-email-legacy-before.sql, never by
// disabling the new commit constraint or faking an old null after migration.
const legacyFacility='ec090000-0000-4000-8000-000000000001';
const legacyEmail='coupon-upgrade-null@example.invalid';
const legacyCoupon='ec090000-0000-4000-8000-000000000002';
const message='ec030000-0000-4000-8000-000000000003';
const envelope = html => JSON.stringify({from:'CareLink <noreply@carelink-jp.com>',to:freshEmail,subject:'Synthetic coupon fixture',html});
const emailLock = (email,id=facility) => `SELECT pg_advisory_xact_lock(hashtextextended('carelink-coupon-email:${id}:${email}',0))`;
const reserve = (email,id=facility) => `SET ROLE service_role; SELECT row_to_json(r) FROM public.reserve_customer_coupon_email_atomic('${id}','${email}',(now() AT TIME ZONE 'Asia/Tokyo')::date+30) r;`;
const prepare = (operation,html) => `SET ROLE service_role; SELECT row_to_json(r) FROM public.prepare_customer_coupon_email_atomic('${operation}','${envelope(html)}'::jsonb) r;`;
let fixtureCreated=false;
async function main() {
  assert.equal(query('SELECT current_database()'),database);
  assert.equal(query("SELECT current_setting('server_version_num')::int/10000"),'17');
  assert.equal(query("SELECT to_regprocedure('public.reserve_customer_coupon_email_atomic(uuid,text,date)') IS NOT NULL"),'t');
  assert.equal(query(`SELECT count(*) FROM public.facility_profiles WHERE id='${facility}'`),'0','fixture UUID must be unused');
  query(`BEGIN; INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status)
    VALUES('${facility}','Synthetic coupon race','synthetic-coupon-race','その他','検証県','検証市','検証住所','published'); COMMIT;`);
  fixtureCreated=true;

  const reservations=(await contend('reserve',emailLock(freshEmail),[reserve(freshEmail),reserve(freshEmail)])).map(JSON.parse);
  const first=reservations[0];
  assert.equal(first.state,'reserved'); assert.equal(reservations[1].state,'reserved');
  assert.equal(reservations[1].coupon_id,first.coupon_id); assert.equal(reservations[1].operation_id,first.operation_id);
  assert.equal(query(`SELECT count(*) FROM public.user_coupon_codes WHERE facility_id='${facility}' AND email='${freshEmail}'`),'1');
  assert.equal(query(`SELECT count(*) FROM public.customer_coupon_email_operations WHERE facility_id='${facility}'`),'1');

  const publications=(await contend('publish',`SELECT pg_advisory_xact_lock(hashtextextended('carelink-coupon-operation:${first.operation_id}',0))`,
    [prepare(first.operation_id,'first candidate'),prepare(first.operation_id,'second candidate')])).map(JSON.parse);
  assert.ok(publications.every(result=>result.id===first.operation_id && result.status==='pending'));
  assert.equal(query(`SELECT count(*) FROM public.webhook_retry_queue WHERE facility_id='${facility}'`),'1');
  assert.ok(['first candidate','second candidate'].includes(query(`SELECT email_envelope->>'html' FROM public.webhook_retry_queue WHERE id='${first.operation_id}'`)));
  assert.equal(query(`SELECT payload->>'customer_coupon_id' FROM public.webhook_retry_queue WHERE id='${first.operation_id}'`),first.coupon_id);
  assert.equal(query(`SELECT payload->>'idempotency_key' FROM public.webhook_retry_queue WHERE id='${first.operation_id}'`),`carelink-event-email/${first.operation_id}`);

  assert.equal(query(`SELECT count(*) FROM public.user_coupon_codes WHERE id='${legacyCoupon}' AND facility_id='${legacyFacility}' AND email='${legacyEmail}' AND provider_accepted_at IS NULL`),'1','old-schema coupon upgrade fixture required');
  const legacy=(await contend('legacy-null',emailLock(legacyEmail,legacyFacility),[reserve(legacyEmail,legacyFacility),reserve(legacyEmail,legacyFacility)])).map(JSON.parse);
  assert.ok(legacy.every(result=>result.state==='legacy_uncertain' && result.coupon_id===legacyCoupon && result.operation_id===null));
  assert.equal(query(`SELECT count(*) FROM public.customer_coupon_email_operations WHERE coupon_id='${legacyCoupon}'`),'0');
  assert.equal(query(`SELECT count(*) FROM public.webhook_retry_queue WHERE facility_id='${facility}'`),'1');

  // Simulate the pre-provider durable fence only. The UUID below is synthetic
  // acceptance evidence; no Resend/SMTP call is made by this test.
  query(`UPDATE public.webhook_retry_queue SET status='processing',claimed_at=clock_timestamp(),delivery_started_at=clock_timestamp() WHERE id='${first.operation_id}';`);
  const accept=`SET ROLE service_role; UPDATE public.webhook_retry_queue SET status='success',provider_message_id='${message}',delivered_at=clock_timestamp(),processed_at=clock_timestamp()
    WHERE id='${first.operation_id}' RETURNING id;`;
  const retry=`SET ROLE service_role; CREATE FUNCTION pg_temp.retry() RETURNS jsonb LANGUAGE plpgsql AS $$ DECLARE r record;p record; BEGIN
    SELECT * INTO r FROM public.reserve_customer_coupon_email_atomic('${facility}','${freshEmail}',(now() AT TIME ZONE 'Asia/Tokyo')::date+30);
    IF r.state='reserved' THEN SELECT * INTO p FROM public.prepare_customer_coupon_email_atomic(r.operation_id,'${envelope('a later retry must not replace the saved envelope')}'::jsonb);
      RETURN jsonb_build_object('reservation',to_jsonb(r),'publication',to_jsonb(p)); END IF;
    RETURN jsonb_build_object('reservation',to_jsonb(r)); END $$; SELECT pg_temp.retry();`;
  const competing=await contend('accept-vs-retry',`SELECT id FROM public.user_coupon_codes WHERE id='${first.coupon_id}' FOR UPDATE`,[accept,retry]);
  assert.equal(competing[0],first.operation_id);
  const replay=JSON.parse(competing[1]);
  assert.equal(replay.reservation.coupon_id,first.coupon_id);
  assert.ok(['reserved','already_notified'].includes(replay.reservation.state));
  if(replay.reservation.state==='reserved')assert.equal(replay.publication.status,'uncertain');
  assert.equal(query(`SELECT count(*) FROM public.customer_coupon_email_operations WHERE facility_id='${facility}'`),'1');
  assert.equal(query(`SELECT count(*) FROM public.webhook_retry_queue WHERE facility_id='${facility}'`),'1');
  assert.equal(query(`SELECT count(*) FROM public.webhook_retry_queue WHERE facility_id='${facility}' AND status='pending'`),'0');
  assert.equal(query(`SELECT status||'|'||provider_message_id::text FROM public.webhook_retry_queue WHERE id='${first.operation_id}'`),`success|${message}`);
  assert.equal(query(`SELECT provider_accepted_at IS NOT NULL FROM public.user_coupon_codes WHERE id='${first.coupon_id}'`),'t');
  const after=JSON.parse(query(reserve(freshEmail))); assert.equal(after.state,'already_notified'); assert.equal(after.operation_id,null);
  console.log('coupon concurrency passed: 4 observed overlaps, 1 coupon/operation/queue, legacy null preserved, acceptance retry creates no new dispatch');
}
try { await main(); }
finally {
  // Terminate only this script's own fixture sessions, never unrelated DB work.
  if(children.size) {
    query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database()
      AND application_name LIKE '${prefix}-%' AND pid<>pg_backend_pid();`);
    for(const child of children)child.kill('SIGTERM');
  }
  if(fixtureCreated) {
    query(`BEGIN; DELETE FROM public.webhook_retry_queue WHERE facility_id='${facility}';
      DELETE FROM public.customer_coupon_email_operations WHERE facility_id='${facility}';
      DELETE FROM public.user_coupon_codes WHERE facility_id='${facility}';
      DELETE FROM public.facility_profiles WHERE id='${facility}'; COMMIT;`);
    assert.equal(query(`SELECT count(*) FROM public.facility_profiles WHERE id='${facility}'`),'0');
    assert.equal(query(`SELECT count(*) FROM public.webhook_retry_queue WHERE facility_id='${facility}'`),'0');
    assert.equal(query(`SELECT count(*) FROM public.customer_coupon_email_operations WHERE facility_id='${facility}'`),'0');
    assert.equal(query(`SELECT count(*) FROM public.user_coupon_codes WHERE facility_id='${facility}'`),'0');
  }
}
