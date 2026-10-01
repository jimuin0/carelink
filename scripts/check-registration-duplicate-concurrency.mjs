// Synthetic-only recovery contracts. No HTTP, provider calls or production DB.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
const root=process.argv[2];
let dbEnv;
const args=['-X','-qAt','-v','ON_ERROR_STOP=1','-d','carelink_shadow'];
const children=new Set();
const query=sql=>execFileSync('psql',args,{env:dbEnv,input:sql,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:30000}).trim();
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
  const name=`duplicate-${label}`;
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

  const actor='b6000000-0000-4000-8000-000000000001';
  const owner='b6000000-0000-4000-8000-000000000002';
  const other='b6000000-0000-4000-8000-000000000003';
  const canonical='b7000000-0000-4000-8000-000000000001';
  const duplicate='b7000000-0000-4000-8000-000000000002';
  const racing='b7000000-0000-4000-8000-000000000003';
  query(`BEGIN;
    INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
      ('${actor}','synthetic-duplicate-admin@example.invalid',clock_timestamp()),
      ('${owner}','synthetic-duplicate-owner@example.invalid',clock_timestamp()),
      ('${other}','synthetic-duplicate-other@example.invalid',clock_timestamp());
    UPDATE public.profiles SET is_platform_admin=true WHERE id='${actor}';
    INSERT INTO public.salons(id,facility_name,business_type,email,phone,representative_name,contact_name,source,prefecture,city,address)
      SELECT id::uuid,'Synthetic duplicate concurrency','ヘアサロン','synthetic-duplicate-owner@example.invalid',
        '09000000000','Synthetic','Synthetic','register','合成県','合成市','合成住所'
      FROM unnest(ARRAY['${canonical}','${duplicate}','${racing}']) id;
    SET LOCAL ROLE service_role;
    SELECT outcome FROM public.setup_facility_from_registration('${owner}','legacy','${canonical}',NULL,NULL,clock_timestamp(),'{}',true);
    COMMIT;`);
  const link=id=>`SET ROLE service_role; SELECT public.link_duplicate_registration(
    '${actor}','${id}','${canonical}',true,0,1,true)->>'outcome';`;
  const lock=`SELECT pg_advisory_xact_lock(hashtextextended('carelink-setup:${owner}',0))`;
  const results=await contend('link',lock,Array.from({length:20},()=>link(duplicate)));
  assert.equal(results.filter(x=>x==='linked').length,1);assert.equal(results.filter(x=>x==='replay').length,19);
  assert.equal(query(`SELECT count(*) FROM public.salon_duplicate_links WHERE duplicate_receipt_id='${duplicate}'`),'1');
  assert.equal(query(`SELECT count(*) FROM public.audit_logs WHERE table_name='salon_duplicate_links' AND record_id='${duplicate}'`),'1');
  const setup=user=>`SET ROLE service_role; SELECT outcome FROM public.setup_facility_from_registration(
    '${user}','legacy','${racing}',NULL,NULL,clock_timestamp(),'{}',true);`;
  // If an old capability wins before linkage, the linker must refuse rather
  // than merge a consumed receipt. If linkage wins, the other user is denied.
  const race=await contend('claim',`SELECT id FROM public.salons WHERE id='${racing}' FOR UPDATE`,[link(racing),setup(other)]);
  assert.ok((race[0]==='linked'&&race[1]==='conflict')||(race[0]==='conflict'&&race[1]==='created'));
  assert.equal(query(`SELECT (EXISTS(SELECT 1 FROM public.salon_duplicate_links WHERE duplicate_receipt_id='${racing}'))::integer +
    (EXISTS(SELECT 1 FROM public.salons WHERE id='${racing}' AND claimed_facility_id IS NOT NULL))::integer`),'1');
  assert.equal(query(`SELECT count(*) FROM public.webhook_retry_queue WHERE webhook_type='facility_welcome' AND payload->>'user_id'='${owner}'`),'1');
  console.log('Duplicate linkage concurrency passed: 20 observed competing linkers, exactly one link/audit, competing legacy claim classified without duplicate writes; synthetic disposable DB only.');
}
main().catch(()=>{console.error('Duplicate linkage concurrency failed; no production access authorized.');process.exitCode=1;})
  .finally(()=>{for(const child of children)child.kill('SIGTERM');});
