// Observe actual PostgreSQL lock contention using only disposable synthetic rows.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
const shadowDocker = process.argv[2] === '--local-docker-shadow';
const local = shadowDocker || process.argv[2] === '--local-docker';
const database = local && !shadowDocker ? 'postgres' : 'carelink_shadow';
let executable; let argumentsFor; let environment;
if (local) {
  assert.match(process.env.DOCKER_HOST || '', /^unix:\/\/.+\/\.docker\/run\/docker\.sock$/);
  assert.equal(process.argv.length, 3);
  executable = 'docker'; environment = process.env;
  argumentsFor = name => ['exec','-i','-e',`PGAPPNAME=${name}`,'supabase_db_carelink','psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1','-d',database];
} else {
  assert.equal(process.env.GITHUB_ACTIONS,'true'); assert.equal(process.env.CI,'true');
  assert.ok(['localhost','127.0.0.1'].includes(process.env.PGHOST)); assert.equal(process.env.PGPORT,'5432'); assert.equal(process.env.PGUSER,'postgres');
  assert.ok(process.env.PGPASSWORD); assert.ok(!process.env.PGSERVICE && !process.env.PGSERVICEFILE && !process.env.PGHOSTADDR);
  executable='psql'; environment={ PATH:process.env.PATH, PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGPASSWORD:process.env.PGPASSWORD,PGSSLMODE:'disable' };
  argumentsFor = () => ['-X','-qAt','-v','ON_ERROR_STOP=1','-d',database];
}
const children = new Set();
const query = sql => execFileSync(executable, argumentsFor('staff-fixture-query'), { env:environment,input:sql,encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe'] }).trim();
function client(sql, name) {
  const child=spawn(executable,argumentsFor(name),{ env:environment,stdio:['pipe','pipe','pipe'] });
  children.add(child); let output='';
  const done=new Promise((resolve,reject) => {
    const timer=setTimeout(() => { child.kill('SIGTERM'); reject(new Error('fixture timeout')); },30000);
    child.stdout.on('data',chunk=>{ output+=chunk; }); child.stderr.resume();
    child.on('error',()=>{ clearTimeout(timer); reject(new Error('fixture client error')); });
    child.on('close',code=>{ clearTimeout(timer); children.delete(child); if(code===0)resolve(output.trim());else reject(new Error('fixture query failed')); });
    child.stdin.on('error',()=>child.kill('SIGTERM'));
  });
  if(sql!==undefined)child.stdin.end(sql); return { child,done,output:()=>output };
}
async function contend(label, lock, calls) {
  const name=`staff-atomic-${label}`; const coordinator=client(undefined,`${name}-coordinator`);
  let ended=false; const coordinated=coordinator.done.then(value=>{ended=true;return value;},error=>{ended=true;throw error;});
  coordinator.child.stdin.write(`BEGIN; ${lock}; SELECT 'locked';\n`);
  const deadline=Date.now()+20000;
  while(!coordinator.output().includes('locked\n')) { if(ended||Date.now()>deadline)throw new Error('fixture lock unavailable'); await new Promise(resolve=>setTimeout(resolve,20)); }
  const workers=calls.map(sql=>client(sql,name).done);
  coordinator.child.stdin.end(`DO $$ DECLARE deadline timestamptz:=clock_timestamp()+interval '20 seconds'; BEGIN LOOP
    PERFORM pg_stat_clear_snapshot(); EXIT WHEN (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='${name}' AND state='active' AND wait_event_type='Lock')=${calls.length};
    IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'overlap not observed'; END IF; PERFORM pg_sleep(0.02); END LOOP; END $$;
    SELECT 'overlap-observed'; COMMIT;`);
  const results=await Promise.allSettled(workers); assert.match(await coordinated,/overlap-observed/); assert.ok(results.every(result=>result.status==='fulfilled'));
  console.log(`${label}: actual concurrent wait observed`); return results.map(result=>result.value);
}
const actor='dd010000-0000-4000-8000-000000000001'; const admin='dd010000-0000-4000-8000-000000000002'; const customer='dd010000-0000-4000-8000-000000000003';
const facility='dd020000-0000-4000-8000-000000000001'; const menu='dd030000-0000-4000-8000-000000000001'; const photo='dd040000-0000-4000-8000-000000000001';
const operation=n=>`dd050000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const lock=`SELECT pg_advisory_xact_lock(hashtextextended('carelink-staff-schedule:${facility}',0))`;
const create = n => `SET ROLE service_role; SELECT public.create_staff_with_schedules_atomic('${actor}','${facility}','${operation(n)}','{"name":"Synthetic concurrent staff"}')::text;`;
const weekly = (who,staff,n,schedules) => `SET ROLE service_role; SELECT public.replace_staff_schedules_atomic('${who}','${facility}','${staff}','${operation(n)}','${JSON.stringify(schedules)}',false)::text;`;
let fixtureCreated=false;
async function main() {
  assert.equal(query('SELECT current_database()'),database); assert.equal(query("SELECT current_setting('server_version_num')::int / 10000"),'17');
  assert.equal(query("SELECT to_regprocedure('public.replace_staff_schedules_atomic(uuid,uuid,uuid,uuid,jsonb,boolean)') IS NOT NULL"),'t');
  query(`BEGIN; INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${actor}','staff-race-owner@example.invalid',now()),('${admin}','staff-race-admin@example.invalid',now()),('${customer}','staff-race-customer@example.invalid',now());
    INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status,business_hours) VALUES('${facility}','Synthetic staff race','synthetic-staff-race','その他','検証県','検証市','検証住所','draft',
      '{"mon":{"open":"09:00","close":"19:00"},"tue":{"open":"09:00","close":"19:00"},"wed":{"open":"09:00","close":"19:00"},"thu":{"open":"09:00","close":"19:00"},"fri":{"open":"09:00","close":"19:00"},"sat":{"open":"09:00","close":"19:00"},"sun":{"open":"09:00","close":"19:00"}}');
    INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('${actor}','${facility}','owner'),('${admin}','${facility}','admin');
    INSERT INTO public.facility_menus(id,facility_id,category,name,price,duration_minutes,is_published) VALUES('${menu}','${facility}','synthetic','Synthetic',1000,60,true);
    INSERT INTO public.facility_photos(id,facility_id,photo_url,photo_type) VALUES('${photo}','${facility}','https://example.invalid/synthetic-staff.jpg','exterior'); COMMIT;`);
  fixtureCreated=true;
  const created=await contend('same-create-operation',`SELECT pg_advisory_xact_lock(hashtextextended('staff-operation:${operation(1)}',0))`,[create(1),create(1)]);
  const rows=created.map(value=>JSON.parse(value)); const staff=rows[0].staff.id;
  assert.equal(rows[1].staff.id,staff); assert.equal(rows.filter(row=>row.replayed===true).length,1);
  assert.equal(query(`SELECT count(*) FROM public.staff_profiles WHERE facility_id='${facility}'`),'1');
  assert.equal(query(`SELECT count(*) FROM public.staff_schedules WHERE staff_id='${staff}'`),'7');
  await contend('two-replacements',lock,[weekly(actor,staff,2,[{day_of_week:1,start_time:'09:00',end_time:'18:00'}]),weekly(admin,staff,3,[{day_of_week:2,start_time:'10:00',end_time:'17:00'}])]);
  const final=JSON.parse(query(`SELECT jsonb_agg(jsonb_build_object('day',day_of_week,'start',start_time,'end',end_time)) FROM public.staff_schedules WHERE staff_id='${staff}'`));
  assert.equal(final.length,1); assert.ok(final[0].day===1||final[0].day===2);
  query(`SET ROLE service_role; SELECT public.replace_staff_schedules_atomic('${actor}','${facility}','${staff}','${operation(4)}','${JSON.stringify(Array.from({length:7},(_,day)=>({day_of_week:day,start_time:'09:00',end_time:'19:00'})))}',false);
    UPDATE public.facility_profiles SET status='published' WHERE id='${facility}';`);
  const booking=`SET ROLE service_role; CREATE FUNCTION pg_temp.attempt() RETURNS text LANGUAGE plpgsql AS $$ BEGIN
    RETURN public.create_booking_atomic('${facility}','${staff}','${customer}','${menu}',NULL,'2035-01-08','10:00','11:00','Synthetic','staff-race-booking@example.invalid',NULL,NULL,1000,0,'pending',true)::text;
    EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'STAFF_NOT_WORKING%' THEN RETURN 'staff-not-working'; END IF; RAISE; END $$; SELECT pg_temp.attempt();`;
  const competing=await contend('booking-versus-replacement',lock,[weekly(admin,staff,5,[]),booking]);
  const replaced=JSON.parse(competing[0]); const count=Number(query(`SELECT count(*) FROM public.bookings WHERE facility_id='${facility}'`));
  if(replaced.ok===true){ assert.equal(competing[1],'staff-not-working'); assert.equal(count,0); assert.equal(query(`SELECT count(*) FROM public.staff_schedules WHERE staff_id='${staff}'`),'0'); }
  else { assert.equal(replaced.code,'BOOKINGS_AFFECTED'); assert.equal(replaced.affectedBookings,1); assert.equal(count,1); assert.equal(query(`SELECT count(*) FROM public.staff_schedules WHERE staff_id='${staff}'`),'7'); }
  console.log('staff concurrency passed: one creation, complete replacement, final booking-impact recheck');
}
try { await main(); }
finally {
  for(const child of children)child.kill('SIGTERM');
  if (fixtureCreated) query(`BEGIN; DELETE FROM public.bookings WHERE facility_id='${facility}'; DELETE FROM public.staff_mutation_operations WHERE facility_id='${facility}'; DELETE FROM public.facility_profiles WHERE id='${facility}'; DELETE FROM auth.users WHERE id IN ('${actor}','${admin}','${customer}'); COMMIT;`);
}
