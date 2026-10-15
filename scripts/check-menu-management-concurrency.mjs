// Synthetic PG17 transactions only. No provider calls, real recipients or business cleanup.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
const local = process.argv[2] === '--local-docker';
const database = local ? (process.env.CARELINK_MENU_TEST_DB || 'carelink_shadow') : 'carelink_shadow';
assert.match(database,/^carelink_shadow[a-z0-9_]*$/);
const prefix = `menu-race-${Date.now().toString(36)}-${process.pid}`;
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
    const timer=setTimeout(()=>{ child.kill('SIGTERM'); reject(new Error('menu fixture timeout')); },30000);
    child.stdout.on('data',chunk=>{ output+=chunk; if(output.length>16384)child.kill('SIGTERM'); });
    child.stderr.on('data',chunk=>{ errors=(errors+chunk).slice(0,2048); });
    child.on('error',()=>{ clearTimeout(timer); reject(new Error('menu fixture client failed')); });
    child.on('close',code=>{ clearTimeout(timer); children.delete(child);
      if(code===0)resolve(output.trim()); else reject(new Error(`menu fixture query failed: ${errors.split('\n').find(line=>line.includes('ERROR:')) || 'client exit'}`)); });
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
    if(ended || Date.now()>deadline)throw new Error('menu fixture lock unavailable');
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  const workers=calls.map(sql=>client(sql,name).done);
  coordinator.child.stdin.end(`DO $$ DECLARE deadline timestamptz:=clock_timestamp()+interval '20 seconds'; BEGIN LOOP
    PERFORM pg_stat_clear_snapshot(); EXIT WHEN (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='${name}' AND state='active' AND wait_event_type='Lock')=${calls.length};
    IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'menu concurrency overlap not observed'; END IF; PERFORM pg_sleep(0.02); END LOOP; END $$;
    SELECT 'overlap-observed'; COMMIT;`);
  const results=await Promise.allSettled(workers);
  assert.match(await coordinated,/overlap-observed/);
  console.log(`${label}: actual concurrent PostgreSQL lock wait observed`);
  return results;
}

const actor='fa790000-0000-4000-8000-000000000001';
const facility='fa790001-0000-4000-8000-000000000001';
const a='fa790002-0000-4000-8000-000000000001'; const b='fa790002-0000-4000-8000-000000000002';
const drop=id=>`SET ROLE service_role; SELECT outcome FROM public.delete_admin_menu_atomic('${actor}','${facility}','${id}')`;
let seeded=false;
try {
 assert.equal(query('SELECT current_database()'),database);
 assert.equal(query("SELECT current_setting('server_version_num')::int/10000"),'17');
 assert.equal(query(`SELECT count(*) FROM auth.users WHERE id='${actor}'`),'0');
 query(`BEGIN; INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${actor}','menu-race@example.invalid',now());
 INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES('${facility}','Synthetic menu race','synthetic-menu-race','その他','検証県','検証市','検証住所','published');
 INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('${actor}','${facility}','owner');
 INSERT INTO public.facility_menus(id,facility_id,category,name,sort_order) VALUES('${a}','${facility}','その他','A',0),('${b}','${facility}','その他','B',1); COMMIT;`); seeded=true;
 const deleted=await contend('two-deletes',`SELECT id FROM public.facility_profiles WHERE id='${facility}' FOR UPDATE`,[drop(a),drop(b)]);
 assert.ok(deleted.every(x=>x.status==='fulfilled'));
 assert.deepEqual(deleted.map(x=>x.value).sort(),['deleted','last_menu']);
 assert.equal(query(`SELECT count(*) FROM public.facility_menus WHERE facility_id='${facility}'`),'1');
 const retained=query(`SELECT id FROM public.facility_menus WHERE facility_id='${facility}'`);
 query(`UPDATE public.facility_profiles SET status='draft' WHERE id='${facility}'`);
 const publication=await contend('publish-before-last-delete',`SET ROLE service_role; SELECT public.set_facilities_publication_atomic('${actor}',ARRAY['${facility}'::uuid],true); RESET ROLE`,[drop(retained)]);
 assert.equal(publication[0].status,'fulfilled');assert.equal(publication[0].value,'last_menu');
 query(`INSERT INTO public.facility_menus(id,facility_id,category,name,sort_order) SELECT '${a}','${facility}','その他','A',0 WHERE NOT EXISTS(SELECT 1 FROM public.facility_menus WHERE id='${a}');
 INSERT INTO public.facility_menus(id,facility_id,category,name,sort_order) SELECT '${b}','${facility}','その他','B',1 WHERE NOT EXISTS(SELECT 1 FROM public.facility_menus WHERE id='${b}');`);
 const revision=query(`SELECT updated_at::text FROM public.facility_profiles WHERE id='${facility}'`);
 const reorder=`SET ROLE service_role; SELECT public.reorder_admin_menus_atomic('${actor}','${facility}',ARRAY['${b}','${a}']::uuid[],ARRAY['${a}','${b}']::uuid[],'${revision}')`;
 const reordered=await contend('two-reorders',`SELECT id FROM public.facility_profiles WHERE id='${facility}' FOR UPDATE`,[reorder,reorder]);
 assert.equal(reordered.filter(x=>x.status==='fulfilled').length,1);assert.equal(reordered.filter(x=>x.status==='rejected').length,1);
 assert.equal(query(`SELECT string_agg(name,',' ORDER BY sort_order,id) FROM public.facility_menus WHERE facility_id='${facility}'`),'B,A');
 const revoked=await contend('revoked-membership',`UPDATE public.facility_members SET role='staff' WHERE user_id='${actor}' AND facility_id='${facility}'`,[drop(a)]);
 assert.equal(revoked[0].status,'rejected');assert.equal(query(`SELECT count(*) FROM public.facility_menus WHERE facility_id='${facility}'`),'2');
 const insert=`SET ROLE service_role; INSERT INTO public.facility_menus(facility_id,category,name) VALUES('${facility}','その他','Concurrent name') RETURNING id`;
 const created=await contend('duplicate-name-insert',`SELECT id FROM public.facility_profiles WHERE id='${facility}' FOR UPDATE`,[insert,insert]);
 assert.equal(created.filter(x=>x.status==='fulfilled').length,1);
 const failed=created.filter(x=>x.status==='rejected'); assert.equal(failed.length,1);
 assert.match(failed[0].reason.message,/uniq_facility_menu_name/);
 assert.equal(query(`SELECT count(*) FROM public.facility_menus WHERE facility_id='${facility}' AND name='Concurrent name'`),'1');
 query(`DO $$ BEGIN BEGIN INSERT INTO public.facility_menus(facility_id,category,name) VALUES('${facility}','その他',' Concurrent name '); RAISE EXCEPTION 'whitespace duplicate was accepted'; EXCEPTION WHEN unique_violation THEN NULL; END; END $$;`);
 console.log('menu concurrency: five actual lock overlaps; duplicate name and whitespace-equivalent name rejected by unique index; prior deletion/reorder/role checks retained');
} finally {
 for(const child of children)child.kill('SIGTERM');
 if(seeded) query(`BEGIN; DELETE FROM public.facility_profiles WHERE id='${facility}'; DELETE FROM auth.users WHERE id='${actor}'; COMMIT;`);
}
