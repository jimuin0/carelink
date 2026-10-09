// Synthetic PG17 transactions only. No provider calls, real recipients or business cleanup.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
const local = process.argv[2] === '--local-docker';
const database = local ? 'postgres' : 'carelink_shadow';
const prefix = `retirement-race-${Date.now().toString(36)}-${process.pid}`;
let executable; let argumentsFor; let environment;
if (local) {
  assert.equal(process.argv.length, 3);
  assert.match(process.env.DOCKER_HOST || '', /^unix:\/\/.+\/\.docker\/run\/docker\.sock$/);
  executable = 'docker'; environment = process.env;
  argumentsFor = (name, provider = false) => provider
    ? ['exec','-i','-e',`PGAPPNAME=${name}`,'-e','PGPASSWORD=postgres','supabase_db_carelink','psql','-h','127.0.0.1','-w','-U','supabase_auth_admin','-X','-qAt','-v','ON_ERROR_STOP=1','-d',database]
    : ['exec','-i','-e',`PGAPPNAME=${name}`,'supabase_db_carelink','psql','-U','postgres','-X','-qAt','-v','ON_ERROR_STOP=1','-d',database];
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
function client(sql,name,provider = false) {
  const child=spawn(executable,argumentsFor(name,provider),{env:environment,stdio:['pipe','pipe','pipe']});
  children.add(child); let output=''; let errors='';
  const done=new Promise((resolve,reject) => {
    const timer=setTimeout(()=>{ child.kill('SIGTERM'); reject(new Error('retirement fixture timeout')); },30000);
    child.stdout.on('data',chunk=>{ output+=chunk; if(output.length>16384)child.kill('SIGTERM'); });
    child.stderr.on('data',chunk=>{ errors=(errors+chunk).slice(0,2048); });
    child.on('error',()=>{ clearTimeout(timer); reject(new Error('retirement fixture client failed')); });
    child.on('close',code=>{ clearTimeout(timer); children.delete(child);
      if(code===0)resolve(output.trim()); else reject(new Error(`retirement fixture query failed: ${errors.split('\n').find(line=>line.includes('ERROR:')) || 'client exit'}`)); });
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
    if(ended || Date.now()>deadline)throw new Error('retirement fixture lock unavailable');
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  const workers=calls.map(call=>client(call.sql,name,call.provider).done);
  coordinator.child.stdin.end(`DO $$ DECLARE deadline timestamptz:=clock_timestamp()+interval '20 seconds'; BEGIN LOOP
    PERFORM pg_stat_clear_snapshot(); EXIT WHEN (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='${name}' AND state='active' AND wait_event_type='Lock')=${calls.length};
    IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'retirement concurrency overlap not observed'; END IF; PERFORM pg_sleep(0.02); END LOOP; END $$;
    SELECT 'overlap-observed'; COMMIT;`);
  const results=await Promise.allSettled(workers);
  for(const result of results)if(result.status==='rejected')throw result.reason;
  assert.match(await coordinated,/overlap-observed/);
  console.log(`${label}: actual concurrent PostgreSQL lock wait observed`);
  return results.map(result=>result.value);
}
const owner='ef010000-0000-4000-8000-000000000001';
const coowner='ef010000-0000-4000-8000-000000000002';
const failingOwner='ef010000-0000-4000-8000-000000000003';
const facility='ef020000-0000-4000-8000-000000000001';
const failingFacility='ef020000-0000-4000-8000-000000000003';
const line='Uef000000000000000000000000000003';
let fixtureCreated=false;
function deletion(id) {
  // Local Docker uses the actual existing GoTrue DB role through container
  // loopback, with the standard isolated development password. No role/schema
  // grant is added. The standalone shadow owner supplies CI SQL semantics.
  return `DELETE FROM auth.users WHERE id='${id}' RETURNING id;`;
}
async function ownerJoinWhileDeleting() {
  const name=`${prefix}-owner-join`; const coordinator=client(undefined,`${name}-coord`);
  const pending=coordinator.done; pending.catch(()=>undefined);
  coordinator.child.stdin.write(`BEGIN; SELECT id FROM auth.users WHERE id='${owner}' FOR KEY SHARE; SELECT 'locked';\n`);
  const deadline=Date.now()+20000;
  while(!coordinator.output().includes('locked\n')) {if(Date.now()>deadline)throw new Error('owner fixture lock missing');await new Promise(resolve=>setTimeout(resolve,20));}
  const removal=client(deletion(owner),name,local);
  while(query(`SELECT count(*) FROM pg_stat_activity a WHERE a.datname=current_database() AND a.application_name='${name}'
    AND a.wait_event_type='Lock' AND EXISTS(SELECT 1 FROM pg_stat_activity c WHERE c.application_name='${name}-coord' AND c.pid=ANY(pg_blocking_pids(a.pid)))`)!=='1') {
    if(Date.now()>deadline)throw new Error('Auth deletion overlap missing');await new Promise(resolve=>setTimeout(resolve,20));
  }
  query(`INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('${coowner}','${facility}','owner');`);
  assert.equal(query(`SELECT count(*) FROM public.facility_members WHERE facility_id='${facility}' AND role='owner'`),'2');
  coordinator.child.stdin.end('COMMIT;'); await pending; assert.equal(await removal.done,owner);
  assert.equal(query(`SELECT status FROM public.facility_profiles WHERE id='${facility}'`),'published');
  assert.equal(query(`SELECT count(*) FROM public.facility_members WHERE facility_id='${facility}' AND user_id='${coowner}' AND role='owner'`),'1');
  console.log('owner-join: actual Auth lock wait observed; newly committed co-owner keeps publication');
}
async function lastOwnerVsPublication() {
  const name=`${prefix}-last-owner`; const coordinator=client(undefined,`${name}-coord`);
  const pending=coordinator.done; pending.catch(()=>undefined);
  coordinator.child.stdin.write(`BEGIN; SELECT id FROM public.facility_profiles WHERE id='${facility}' FOR UPDATE; SELECT 'locked';\n`);
  const deadline=Date.now()+20000;
  while(!coordinator.output().includes('locked\n')) {if(Date.now()>deadline)throw new Error('profile fixture lock missing');await new Promise(resolve=>setTimeout(resolve,20));}
  const removal=client(deletion(coowner),name,local);
  while(query(`SELECT count(*) FROM pg_stat_activity a WHERE a.datname=current_database() AND a.application_name='${name}' AND a.wait_event_type='Lock'
    AND EXISTS(SELECT 1 FROM pg_stat_activity c WHERE c.application_name='${name}-coord' AND c.pid=ANY(pg_blocking_pids(a.pid)))`)!=='1') {
    if(Date.now()>deadline)throw new Error('retirement parent lock overlap missing');await new Promise(resolve=>setTimeout(resolve,20));
  }
  const publication=client(`SET ROLE service_role; CREATE FUNCTION pg_temp.publish() RETURNS text LANGUAGE plpgsql AS $$ BEGIN
    PERFORM public.set_facilities_publication_atomic('${coowner}',ARRAY['${facility}'::uuid],true); RETURN 'published';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM='FACILITY_PERMISSION_REVOKED' THEN RETURN 'permission-revoked'; END IF; RAISE; END $$; SELECT pg_temp.publish();`,name);
  while(query(`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='${name}' AND wait_event_type='Lock'`)!=='2') {
    if(Date.now()>deadline)throw new Error('publication/retirement overlap missing');await new Promise(resolve=>setTimeout(resolve,20));
  }
  coordinator.child.stdin.end('COMMIT;'); await pending;
  assert.equal(await removal.done,coowner); assert.equal(await publication.done,'permission-revoked');
  assert.equal(query(`SELECT status FROM public.facility_profiles WHERE id='${facility}'`),'suspended');
  assert.equal(query(`SELECT count(*) FROM public.facility_members WHERE facility_id='${facility}' AND role='owner'`),'0');
  console.log('last-owner: actual parent/permission lock waits observed; stale publication denied');
}
async function main() {
  assert.equal(query('SELECT current_database()'),database); assert.equal(query("SELECT current_setting('server_version_num')::int/10000"),'17');
  assert.equal(query('SELECT public.account_deletion_cleanup_version()'),'1');
  assert.equal(query(`SELECT count(*) FROM public.facility_profiles WHERE id IN ('${facility}','${failingFacility}')`),'0');
  if(local) {
    const role=await client('SELECT current_user;',`${prefix}-auth-check`,true).done; assert.equal(role,'supabase_auth_admin');
    assert.equal(query("SELECT has_function_privilege('supabase_auth_admin','public.cleanup_deleting_account_personal_data()','EXECUTE')"),'f');
  }
  query(`BEGIN; INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${owner}','retirement-race-owner@example.invalid',now()),('${coowner}','retirement-race-coowner@example.invalid',now()),('${failingOwner}','retirement-race-failure@example.invalid',now());
    INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES('${facility}','Synthetic retirement race','synthetic-retirement-race','その他','検証県','検証市','検証住所','published'),('${failingFacility}','Synthetic Auth failure','synthetic-auth-failure-race','その他','検証県','検証市','検証住所','published');
    INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('${owner}','${facility}','owner'),('${failingOwner}','${failingFacility}','owner');
    UPDATE public.profiles SET line_user_id='${line}' WHERE id='${failingOwner}';
    INSERT INTO public.line_user_links(line_user_id,display_name) VALUES('${line}','Synthetic retained follower');
    INSERT INTO public.favorites(user_id,facility_id) VALUES('${failingOwner}','${failingFacility}');
    INSERT INTO public.user_points(user_id,points,reason) VALUES('${failingOwner}',123,'Synthetic failed-retirement balance'); COMMIT;`);
  fixtureCreated=true;
  await ownerJoinWhileDeleting(); await lastOwnerVsPublication();
  // Force a failure AFTER all 17 cleanup operations executed, without adding
  // any global fixture trigger/permission. A transaction rollback must restore
  // every earlier cleanup and the last-owner suspension.
  const rollback=await client(`BEGIN; DELETE FROM auth.users WHERE id='${failingOwner}' RETURNING id; ROLLBACK;`,`${prefix}-provider-rollback`,local).done;
  assert.equal(rollback,failingOwner);
  assert.equal(query(`SELECT count(*) FROM auth.users WHERE id='${failingOwner}'`),'1');
  assert.equal(query(`SELECT count(*) FROM public.favorites WHERE user_id='${failingOwner}'`),'1');
  assert.equal(query(`SELECT sum(points) FROM public.user_points WHERE user_id='${failingOwner}'`),'123');
  assert.equal(query(`SELECT count(*) FROM public.line_user_links WHERE line_user_id='${line}'`),'1');
  assert.equal(query(`SELECT status FROM public.facility_profiles WHERE id='${failingFacility}'`),'published');
  console.log(`retirement concurrency passed: new co-owner race, last-owner/stale-publication race, complete cleanup rollback${local ? ', actual existing Auth DB role with no direct trigger EXECUTE' : ', standalone shadow role semantics'}; synthetic only`);
}
try { await main(); }
finally {
  if(children.size) {query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE '${prefix}-%' AND pid<>pg_backend_pid();`);for(const child of children)child.kill('SIGTERM');}
  if(fixtureCreated) {
    query(`BEGIN; DELETE FROM public.facility_profiles WHERE id IN ('${facility}','${failingFacility}'); DELETE FROM auth.users WHERE id IN ('${owner}','${coowner}','${failingOwner}'); COMMIT;`);
    assert.equal(query(`SELECT count(*) FROM auth.users WHERE id IN ('${owner}','${coowner}','${failingOwner}')`),'0');
    assert.equal(query(`SELECT count(*) FROM public.facility_profiles WHERE id IN ('${facility}','${failingFacility}')`),'0');
    assert.equal(query(`SELECT count(*) FROM public.line_user_links WHERE line_user_id='${line}'`),'0');
  }
}
