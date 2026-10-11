// Synthetic fixtures only. Observe real lock contention, not merely concurrent promises.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';

const localDockerShadow = process.argv[2] === '--local-docker-shadow';
const root = localDockerShadow ? undefined : process.argv[2];
const database = (root || localDockerShadow) ? (process.argv[3] || 'carelink_shadow') : 'carelink_shadow';
assert.ok(['carelink_shadow','carelink_shadow_batch2_points'].includes(database));
const psql = localDockerShadow ? '/Users/kam/Projects/carelink-resume-evidence-20261008/runtime/pg-cli-bridge/psql' : 'psql';
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-d', database];
const runPrefix = `bc-${process.pid}-${Date.now().toString(36).slice(-5)}`;
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
const owner='bcb40000-0000-4000-8000-000000000001',actor='bcb40000-0000-4000-8000-000000000002',other='bcb40000-0000-4000-8000-000000000003',fourth='bcb40000-0000-4000-8000-000000000004';
const facility='bcb41000-0000-4000-8000-000000000001',menu='bcb42000-0000-4000-8000-000000000001',staff='bcb43000-0000-4000-8000-000000000001';
const op=n=>`bcb44000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const proof={};
function prepare(n){query(`SET ROLE service_role;SELECT * FROM public.prepare_booking_create_operation('${op(n)}','${actor}',NULL,'${facility}',repeat('a',64));`);}
function booking(n,start='10:00'){
 const snapshot={customer_name:'Synthetic',email:'proxy@example.invalid',facility_name:'Receipt synthetic',menu_name:'Synthetic',staff_name:'Synthetic',booking_date:'2030-01-07',start_time:start,end_time:`${start.slice(0,2)}:30`,total_price:400,status:'confirmed'};
 const plan=[{kind:'email',role:'customer',target:'proxy@example.invalid',envelope:{from:'sender@example.invalid',to:'proxy@example.invalid',subject:'Synthetic',html:'<p>Synthetic</p>'},snapshot,context:{owner_ids:[owner],owner_push:false,works_enabled:false,line_enabled:false}},
 {kind:'push',role:'customer',target:actor,payload:{title:'Synthetic',body:'Synthetic'},snapshot}];
 return `SET ROLE service_role; SELECT response_payload->>'bookingId' FROM public.create_booking_with_receipt_atomic('${op(n)}','${actor}',NULL,repeat('a',64),'${facility}','${staff}','${menu}',NULL,'2030-01-07','${start}','${start}'::time+interval '30 minutes','Synthetic','proxy@example.invalid',NULL,NULL,400,100,'confirmed',ARRAY['${menu}'::uuid],'${JSON.stringify(plan)}'::jsonb);`;
}
function close(n){return `SET ROLE service_role;SELECT state FROM public.inspect_booking_create_operation('${op(n)}','${actor}',NULL,true);`;}
// A holds a real transaction after the operation has completed; B must have a
// pg_stat_activity blocker before A is allowed to commit. No fixed race sleeps.
async function ordered(label,first,second){
 const firstName=`${runPrefix}-${label}-first`,secondName=`${runPrefix}-${label}-second`;
 const a=client(undefined,firstName);let ended=false;const completed=a.done.then(v=>{ended=true;return v;},e=>{ended=true;throw e;});
 a.child.stdin.write(`BEGIN;${first}SELECT 'operation-held';\n`);
 const deadline=Date.now()+20000;
 while(!a.output().includes('operation-held\n')){if(ended||Date.now()>deadline){stop(a.child);throw Error('first operation not held');}await new Promise(r=>setTimeout(r,20));}
 const b=client(`BEGIN;${second}COMMIT;`,secondName);const settled=b.done.then(value=>({value}),error=>({error:error.message}));
 while(query(`SELECT count(*) FROM pg_stat_activity a WHERE a.datname=current_database() AND a.application_name='${secondName}' AND a.state='active' AND a.wait_event_type='Lock' AND EXISTS(SELECT 1 FROM pg_stat_activity p WHERE p.application_name='${firstName}' AND p.pid=ANY(pg_blocking_pids(a.pid)))`)!=='1'){
   if(Date.now()>deadline){stop(a.child);stop(b.child);throw Error('actual operation overlap not observed');}await new Promise(r=>setTimeout(r,20));}
 a.child.stdin.end('COMMIT;');const result=[(await completed).split('\n').filter(line=>line!=='operation-held').join('\n'),await settled];proof[label]=true;return result;
}
async function main(){
  if (process.env.PGSERVICE || process.env.PGSERVICEFILE || process.env.PGHOSTADDR) throw new Error('alternate connection refused');
  if (localDockerShadow) {
    assert.ok([3,4].includes(process.argv.length));
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

 assert.equal(query('SET ROLE service_role;SELECT public.webhook_dispatch_v2_version();'),'1');
 assert.equal(query(`SELECT count(*) FROM public.facility_profiles WHERE id='${facility}'`),'0');
 assert.equal(query(`SELECT count(*) FROM auth.users WHERE id IN ('${owner}','${actor}','${other}','${fourth}')`),'0');
 const fixture=readFileSync(new URL('../supabase/shadow/booking-create-receipt-fixtures.sql',import.meta.url),'utf8');
 let seed=fixture.slice(fixture.indexOf('INSERT INTO auth.users'),fixture.indexOf('CREATE FUNCTION pg_temp.receipt_create')).replaceAll('bea4','bcb4').replaceAll('receipt-synthetic','receipt-concurrency-synthetic').replaceAll('receipt-staff','receipt-concurrency-staff');
 seed=seed.replace("('bcb40000-0000-4000-8000-000000000003','receipt-other@example.invalid',now());",`('${other}','receipt-other@example.invalid',now()),('${fourth}','receipt-fourth@example.invalid',now());`);
 query(`BEGIN;${seed}COMMIT;`);fixtureOwned=true;
 prepare(1);let results=await ordered('same-key-one-booking',booking(1),booking(1));assert.equal(results[0],results[1].value);assert.match(results[0],/^[a-f0-9-]{36}$/);
 prepare(2);results=await ordered('create-before-close',booking(2,'11:00'),close(2));assert.equal(results[1].value,'committed');
 prepare(3);results=await ordered('close-before-create',close(3),booking(3,'12:00'));assert.match(results[1].error,/BOOKING_CREATE_CLOSED/);
 assert.equal(query(`SELECT count(*) FROM public.bookings WHERE facility_id='${facility}';SELECT sum(points) FROM public.user_points WHERE user_id='${actor}';SELECT count(*) FROM public.webhook_retry_queue WHERE facility_id='${facility}';`),'2\n300\n4');
 const queue=query(`SELECT id FROM public.webhook_retry_queue WHERE payload->>'booking_create_operation'='${op(1)}' AND webhook_type='email'`);
 query(`SET ROLE service_role;SELECT count(*) FROM public.claim_webhook_retry_queue_v2(ARRAY['${queue}'::uuid],'2030-01-01T00:00Z');`);
 const start=`SET ROLE service_role;SELECT outcome FROM public.start_booking_create_notification('${queue}','2030-01-01T00:00Z');`;
 results=await ordered('one-notification-start',start,start);assert.equal(results[0],'ready');assert.equal(results[1].value,'not_owned');
 query(`INSERT INTO public.referral_codes(code,user_id,used_count) VALUES('RACEBCB1','${owner}',0);`);
 const referral=id=>`SET ROLE service_role;SELECT replayed FROM public.apply_referral_code_atomic('${id}','RACEBCB1');`;
 results=await ordered('referral-different-users',referral(other),referral(fourth));assert.equal(results[0],'f');assert.equal(results[1].value,'f');
 results=await ordered('referral-same-user-replay',referral(other),referral(other));assert.equal(results[0],'t');assert.equal(results[1].value,'t');
 assert.equal(query(`SELECT used_count FROM public.referral_codes WHERE code='RACEBCB1';SELECT count(*) FROM public.referral_uses WHERE code='RACEBCB1';`),'2\n2');
 // Raw old and formal new workers overlap on the SAME V2 pending job.
 const pending=query(`SELECT id FROM public.webhook_retry_queue WHERE payload->>'booking_create_operation'='${op(2)}' AND webhook_type='email'`);
 results=await ordered('new-claim-vs-old-raw',`SET ROLE service_role;SELECT count(*) FROM public.claim_webhook_retry_queue_v2(ARRAY['${pending}'::uuid],'2030-01-01T00:01Z');`,
 `SET ROLE service_role;WITH changed AS(UPDATE public.webhook_retry_queue SET status='processing',claimed_at='2030-01-01T00:02Z',attempt_count=attempt_count+1 WHERE id='${pending}' AND status='pending' RETURNING id)SELECT count(*) FROM changed;`);
 assert.equal(results[0],'1');assert.equal(results[1].value,'0');assert.equal(query(`SELECT attempt_count FROM public.webhook_retry_queue WHERE id='${pending}'`),'0');
 prepare(4);
 results=await ordered('owner-added-after-plan',`INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('${other}','${facility}','admin');SELECT id FROM public.facility_profiles WHERE id='${facility}' FOR NO KEY UPDATE;`,booking(4,'12:00'));
 assert.match(results[1].error,/BOOKING_NOTIFICATION_TARGET_CHANGED/);
 const photo=query(`SELECT id FROM public.facility_photos WHERE facility_id='${facility}' LIMIT 1`);
 prepare(5);results=await ordered('undeclared-new-admin-photo-overlap',`SET ROLE service_role;SELECT id FROM public.set_facility_main_photo_atomic('${other}','${facility}','${photo}');`,booking(5,'12:00'));
 assert.equal(results[0],facility);assert.match(results[1].error,/BOOKING_NOTIFICATION_TARGET_CHANGED/);
 prepare(6);results=await ordered('owner-role-revoke-overlap',`UPDATE public.facility_members SET role='staff' WHERE user_id='${owner}' AND facility_id='${facility}';`,booking(6,'12:00'));
 assert.match(results[1].error,/BOOKING_NOTIFICATION_TARGET_CHANGED/);
 assert.equal(query(`SELECT count(*) FROM public.bookings WHERE facility_id='${facility}'`),'2');

}
try{await main();console.log(JSON.stringify({observed:true,checks:proof}));}
finally{
 for(const c of children)stop(c);
 if(fixtureOwned){query(`BEGIN;DELETE FROM public.webhook_retry_queue WHERE facility_id='${facility}';DELETE FROM public.booking_create_operations WHERE facility_id='${facility}';DELETE FROM public.facility_profiles WHERE id='${facility}' AND slug='receipt-concurrency-synthetic';DELETE FROM auth.users WHERE id IN ('${owner}','${actor}','${other}','${fourth}');COMMIT;`);console.log('Synthetic booking/referral/claim fixtures removed');}
}
