// Observe actual PostgreSQL lock contention using only disposable synthetic rows.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
const authShadow = process.argv[2] === '--local-auth-shadow';
const shadowDocker = process.argv[2] === '--local-docker-shadow';
const local = authShadow || shadowDocker || false;
const database = authShadow ? 'carelink_shadow_batch2_auth' : 'carelink_shadow';
let executable; let argumentsFor; let environment;
if (local) {
  assert.match(process.env.DOCKER_HOST || '', /^unix:\/\/.+\/\.docker\/run\/docker\.sock$/);
  assert.equal(process.argv.length, 3);
  executable = 'docker'; environment = process.env;
  argumentsFor = () => ['exec','-i','supabase_db_carelink','psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1','-d',database];
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
  assert.match(name,/^[a-z0-9-]+$/);
  const child=spawn(executable,argumentsFor(name),{ env:environment,stdio:['pipe','pipe','pipe'] });
  children.add(child); let output='';
  const done=new Promise((resolve,reject) => {
    const timer=setTimeout(() => { child.kill('SIGTERM'); reject(new Error('fixture timeout')); },30000);
    child.stdout.on('data',chunk=>{ output+=chunk; }); child.stderr.resume();
    child.on('error',()=>{ clearTimeout(timer); reject(new Error('fixture client error')); });
    child.on('close',code=>{ clearTimeout(timer); children.delete(child); if(code===0)resolve(output.trim());else reject(new Error('fixture query failed')); });
    child.stdin.on('error',()=>child.kill('SIGTERM'));
  });
  // Use SQL in both modes: PGAPPNAME in Docker had hidden the missing name
  // on the real psql CI path, so the overlap barrier never saw its clients.
  child.stdin.write(`SET application_name='${name}';\n`);
  if(sql!==undefined)child.stdin.end(sql); return { child,done,output:()=>output };
}
async function contend(label, lock, calls, release='COMMIT;') {
  const name=`line-proof-${label}`; const coordinator=client(undefined,`${name}-coordinator`);
  let ended=false; const coordinated=coordinator.done.then(value=>{ended=true;return value;},error=>{ended=true;throw error;});
  coordinator.child.stdin.write(`BEGIN; ${lock}; SELECT 'locked';\n`);
  const deadline=Date.now()+20000;
  while(!coordinator.output().includes('locked\n')) { if(ended||Date.now()>deadline)throw new Error('fixture lock unavailable'); await new Promise(resolve=>setTimeout(resolve,20)); }
  const workers=calls.map(sql=>client(sql,name).done);
  coordinator.child.stdin.end(`DO $$ DECLARE deadline timestamptz:=clock_timestamp()+interval '20 seconds'; BEGIN LOOP
    PERFORM pg_stat_clear_snapshot(); EXIT WHEN (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='${name}' AND state='active' AND wait_event_type='Lock')=${calls.length};
    IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'overlap not observed'; END IF; PERFORM pg_sleep(0.02); END LOOP; END $$;
    SELECT 'overlap-observed'; ${release}`);
  const results=await Promise.allSettled(workers); assert.match(await coordinated,/overlap-observed/); assert.ok(results.every(result=>result.status==='fulfilled'));
  console.log(`${label}: actual concurrent wait observed`); return results.map(result=>result.value);
}

const actor='c9110000-0000-4000-8000-000000000001';
const other='c9110000-0000-4000-8000-000000000002';
const retiring='c9110000-0000-4000-8000-000000000003';
const line='U_synthetic_line_concurrency';
const retirementLine='U_synthetic_line_retirement';
const attempt=(who,id)=>`SET ROLE service_role; SELECT public.bind_verified_liff_account_atomic('${who}','${id}');`;
const actorGuardAttempt=(who,id)=>`SET ROLE service_role;
CREATE FUNCTION pg_temp.try_bind() RETURNS text LANGUAGE plpgsql AS $$ BEGIN
 RETURN public.bind_verified_liff_account_atomic('${who}','${id}');
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='BOOKING_ACCOUNT_UNAVAILABLE' THEN RETURN 'account-unavailable'; END IF; RAISE;
 END $$; SELECT pg_temp.try_bind();`;
let owned=false;
async function main(){
 assert.equal(query('SELECT current_database()'),database);
 assert.equal(query("SELECT current_setting('server_version_num')::int/10000"),'17');
 assert.equal(query("SELECT to_regprocedure('public.bind_verified_liff_account_atomic(uuid,text)') IS NOT NULL"),'t');
 assert.equal(query(`SELECT count(*) FROM auth.users WHERE id IN ('${actor}','${other}','${retiring}')`),'0');
 assert.equal(query(`SELECT count(*) FROM public.line_user_links WHERE line_user_id IN ('${line}','${retirementLine}')`),'0');
 query(`BEGIN; INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('${actor}','synthetic-line-race-1@example.invalid',now()),('${other}','synthetic-line-race-2@example.invalid',now()),
 ('${retiring}','synthetic-line-race-3@example.invalid',now()); COMMIT;`);owned=true;
 const race=await contend('two-actors-one-line',`SELECT pg_advisory_xact_lock(hashtextextended('carelink-line-binding:${line}',0))`,[attempt(actor,line),attempt(other,line)]);
 assert.deepEqual([...race].sort(),['conflict','linked']);
 const winner=race[0]==='linked'?actor:other;
 assert.equal(query(`SELECT count(*) FROM public.line_user_links WHERE line_user_id='${line}' AND user_id='${winner}' AND proof_version=1 AND verified_at IS NOT NULL`),'1');
 assert.equal(query(`SELECT count(*) FROM public.profiles WHERE line_user_id='${line}'`),'1');
 const proofBefore=query(`SELECT verified_at::text FROM public.line_user_links WHERE line_user_id='${line}'`);
 const replay=await contend('same-actor-replay',`SELECT pg_advisory_xact_lock(hashtextextended('carelink-points:${winner}',0))`,[attempt(winner,line),attempt(winner,line)]);
 assert.deepEqual(replay,['linked','linked']);assert.equal(query(`SELECT verified_at::text FROM public.line_user_links WHERE line_user_id='${line}'`),proofBefore);
 // Auth deletion locks the account first; the blocked linking process must
 // actually execute the retirement guard rather than fail on RPC privileges.
 const retired=await contend('retirement-before-bind',`SELECT id FROM auth.users WHERE id='${retiring}' FOR UPDATE`,[actorGuardAttempt(retiring,retirementLine)],`DELETE FROM auth.users WHERE id='${retiring}'; COMMIT;`);
 assert.deepEqual(retired,['account-unavailable']);
 assert.equal(query(`SELECT count(*) FROM public.line_user_links WHERE line_user_id='${retirementLine}'`),'0');
 // Recreate only the synthetic actor and prove a linking transaction that has
 // acquired its account lock completes before Auth CASCADE removes both halves.
 query(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${retiring}','synthetic-line-race-3@example.invalid',now())`);
 const name='line-proof-bind-before-retirement';const coordinator=client(undefined,`${name}-coordinator`);
 coordinator.child.stdin.write(`BEGIN; SELECT id FROM public.profiles WHERE id='${retiring}' FOR UPDATE; SELECT 'locked';\n`);
 const deadline=Date.now()+20000;
 while(!coordinator.output().includes('locked\n')){if(Date.now()>deadline)throw new Error('lock not acquired');await new Promise(r=>setTimeout(r,20));}
 const binder=client(attempt(retiring,retirementLine),name);
 coordinator.child.stdin.write(`DO $$ DECLARE deadline timestamptz:=clock_timestamp()+interval '20 seconds'; BEGIN LOOP
 PERFORM pg_stat_clear_snapshot(); EXIT WHEN EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}' AND state='active' AND wait_event_type='Lock');
 IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'binding overlap not observed'; END IF; PERFORM pg_sleep(0.02); END LOOP; END $$; SELECT 'binding-blocked';\n`);
 while(!coordinator.output().includes('binding-blocked\n')) { if(Date.now()>deadline)throw new Error('binding overlap not acquired'); await new Promise(r=>setTimeout(r,20)); }
 const deletion=client(`DELETE FROM auth.users WHERE id='${retiring}'; SELECT 'deleted';`,`${name}-delete`);
 coordinator.child.stdin.end(`DO $$ DECLARE deadline timestamptz:=clock_timestamp()+interval '20 seconds'; BEGIN LOOP
 PERFORM pg_stat_clear_snapshot(); EXIT WHEN EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${name}-delete' AND state='active' AND wait_event_type='Lock');
 IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'retirement overlap not observed'; END IF; PERFORM pg_sleep(0.02); END LOOP; END $$;
 SELECT 'overlap-observed'; COMMIT;`);
 assert.match(await coordinator.done,/overlap-observed/);assert.equal(await binder.done,'linked');assert.equal(await deletion.done,'deleted');
 assert.equal(query(`SELECT count(*) FROM public.line_user_links WHERE line_user_id='${retirementLine}'`),'0');
 assert.equal(query(`SELECT count(*) FROM public.profiles WHERE id='${retiring}'`),'0');
 console.log('bind-before-retirement: actual concurrent wait observed');
 console.log('LINE proof concurrency passed: one owner, exact replay, Auth delete in both orders');
}
try {await main();}
finally {
 for(const child of children)child.kill('SIGTERM');
 if(owned){query(`BEGIN; DELETE FROM public.line_user_links WHERE line_user_id IN ('${line}','${retirementLine}'); DELETE FROM auth.users WHERE id IN ('${actor}','${other}','${retiring}'); COMMIT;`);
 assert.equal(query(`SELECT count(*) FROM auth.users WHERE id IN ('${actor}','${other}','${retiring}')`),'0');
 assert.equal(query(`SELECT count(*) FROM public.line_user_links WHERE line_user_id IN ('${line}','${retirementLine}')`),'0');console.log('synthetic LINE rows remaining: 0');}
}
