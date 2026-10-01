// Synthetic-only recovery contracts. No HTTP, provider calls or production DB.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
const root=process.argv[2];
let dbEnv;
const args=['-X','-qAt','-v','ON_ERROR_STOP=1','-d','carelink_shadow'];
const children=new Set();
const query=sql=>execFileSync('psql',args,{env:dbEnv,input:sql,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:30000}).trim();
const user='a6000000-0000-4000-8000-000000000001';
const receipt='a7000000-0000-4000-8000-000000000001';
const grant='a8000000-0000-4000-8000-000000000001';
function client(sql,name) {
  const child=spawn('psql',args,{env:{...dbEnv,PGAPPNAME:name},stdio:['pipe','pipe','pipe']});children.add(child);
  let output='';
  const done=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill('SIGTERM');reject(new Error('bounded fixture timeout'));},30000);
    child.stdout.on('data',data=>{output+=data;if(output.length>4096)child.kill('SIGTERM');});child.stderr.resume();
    child.once('error',()=>{clearTimeout(timer);reject(new Error('fixture process failed'));});
    child.once('close',code=>{clearTimeout(timer);children.delete(child);if(code===0)resolve(output.trim());else reject(new Error('fixture query failed'));});
    child.stdin.on('error',()=>child.kill('SIGTERM'));
  });
  if(sql!==undefined)child.stdin.end(sql);
  return {child,done,output:()=>output};
}
async function contend(label,lock,calls,release='COMMIT;') {
  const name=`recovery-${label}`;
  const coordinator=client(undefined,`${name}-coordinator`);
  let ended=false;
  const coordinated=coordinator.done.then(value=>{ended=true;return value;},()=>{ended=true;return '';});
  coordinator.child.stdin.write(`BEGIN; ${lock}; SELECT 'locked';\n`);
  const deadline=Date.now()+20000;
  while(!coordinator.output().includes('locked\n')) {
    if(ended||Date.now()>deadline)throw new Error('fixture lock not acquired');
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  const workers=calls.map(sql=>client(sql,name).done);
  coordinator.child.stdin.end(`DO $$ DECLARE deadline timestamptz:=clock_timestamp()+interval '20 seconds'; BEGIN
    LOOP PERFORM pg_stat_clear_snapshot();
      EXIT WHEN (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='${name}'
        AND state='active' AND wait_event_type='Lock')=${calls.length};
      IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'overlap not observed'; END IF;
      PERFORM pg_sleep(0.02);
    END LOOP; END $$; SELECT 'overlap-observed'; ${release}`);
  const results=await Promise.allSettled(workers);
  assert.match(await coordinated,/overlap-observed/);assert.ok(results.every(row=>row.status==='fulfilled'));
  return results.map(row=>row.value);
}
async function main() {
  if(process.env.PGSERVICE||process.env.PGSERVICEFILE||process.env.PGHOSTADDR)throw new Error('alternate connection refused');
  if(root) {
    assert.match(root,/^\/tmp\/carelink-pg17-postgis\.[a-zA-Z0-9]+$/);
    const stat=statSync(root);assert.ok(stat.isDirectory());assert.equal(stat.uid,process.getuid());assert.equal(stat.mode&0o777,0o700);
    dbEnv={PATH:process.env.PATH,PGHOST:`${root}/socket`,PGPORT:'56419',PGUSER:process.env.USER||'kanbararyousuke',PGSSLMODE:'disable'};
    assert.equal(query('SHOW listen_addresses'),'');assert.equal(realpathSync(query('SHOW data_directory')),realpathSync(`${root}/data`));
  } else {
    assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.CI,'true');
    assert.ok(['localhost','127.0.0.1'].includes(process.env.PGHOST));assert.equal(process.env.PGPORT,'5432');
    assert.equal(process.env.PGUSER,'postgres');assert.ok(process.env.PGPASSWORD);
    dbEnv={PATH:process.env.PATH,PGHOST:'127.0.0.1',PGPORT:'5432',PGUSER:'postgres',PGPASSWORD:process.env.PGPASSWORD,PGSSLMODE:'disable'};
  }
  assert.equal(query('SELECT current_database()'),'carelink_shadow');
  query(`BEGIN; INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${user}','synthetic-recovery@example.invalid',clock_timestamp());
    INSERT INTO public.salons(id,facility_name,business_type,email,phone,representative_name,contact_name,source)
    VALUES('${receipt}','Synthetic recovery concurrency','ヘアサロン','synthetic-recovery@example.invalid','09000000000','Synthetic','Synthetic','register'); COMMIT;`);
  const twenty=sql=>Array.from({length:20},()=>sql);
  const userLock=`SELECT pg_advisory_xact_lock(hashtextextended('carelink-setup:${user}',0))`;
  const prepare=`SET ROLE service_role; SELECT outcome FROM public.prepare_salon_recovery('${user}','${receipt}','${grant}',repeat('a',64));`;
  assert.ok((await contend('prepare',userLock,twenty(prepare))).every(value=>value==='prepared'));
  assert.equal(query(`SELECT count(*) FROM public.salon_recovery_grants WHERE id='${grant}'`),'1');
  const summary=`SET ROLE service_role; SELECT outcome FROM public.read_salon_recovery('${user}','${grant}',repeat('a',64));`;
  assert.ok((await contend('email',`UPDATE auth.users SET email='changed@example.invalid' WHERE id='${user}'`,twenty(summary))).every(value=>value==='unverified'));
  query(`UPDATE auth.users SET email='synthetic-recovery@example.invalid' WHERE id='${user}'`);
  const setup=`SET ROLE service_role; SELECT outcome||'|'||coalesce(facility_id::text,'') FROM public.setup_facility_from_registration(
    '${user}','recovered',NULL,'${grant}',repeat('a',64),NULL,'{}',true);`;
  const results=await contend('setup',userLock,twenty(setup));
  assert.equal(results.filter(value=>value.startsWith('created|')).length,1);
  assert.equal(results.filter(value=>value.startsWith('replay|')).length,19);
  assert.equal(new Set(results.map(value=>value.split('|')[1])).size,1);
  assert.equal(query(`SELECT count(*) FROM public.webhook_retry_queue WHERE webhook_type='facility_welcome' AND payload->>'user_id'='${user}'`),'1');
  // Receipt wait must recheck expiry, not use a transaction-start timestamp.
  query(`UPDATE public.salon_recovery_grants SET created_at=statement_timestamp()-interval '72 hours'+interval '3 seconds',
    expires_at=statement_timestamp()+interval '3 seconds' WHERE id='${grant}'`);
  const timing=`DO $$ BEGIN
    IF (SELECT max(xact_start) FROM pg_stat_activity WHERE application_name='recovery-expiry' AND state='active') >=
      (SELECT expires_at FROM public.salon_recovery_grants WHERE id='${grant}') THEN RAISE EXCEPTION 'started after expiry'; END IF;
    END $$; SELECT pg_sleep(3.1); COMMIT;`;
  assert.deepEqual(await contend('expiry',`SELECT id FROM public.salons WHERE id='${receipt}' FOR UPDATE`,[summary],timing),['unverified']);
  console.log('Recovery concurrency passed: 3 x 20 observed competing clients; one immutable grant, current-email revocation, one facility/welcome, and expiry after receipt lock. Synthetic disposable DB only.');
}
main().catch(()=>{console.error('Registration recovery concurrency failed; no production access authorized.');process.exitCode=1;})
  .finally(()=>{for(const child of children)child.kill('SIGTERM');});
