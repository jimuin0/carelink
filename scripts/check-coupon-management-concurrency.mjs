// Synthetic PG17 transactions only. No provider calls, real recipients or business cleanup.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
const local = process.argv[2] === '--local-docker';
const database = local ? (process.env.CARELINK_COUPON_TEST_DB || 'carelink_shadow') : 'carelink_shadow';
assert.match(database,/^carelink_shadow[a-z0-9_]*$/);
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
  assert.match(await coordinated,/overlap-observed/);
  console.log(`${label}: actual concurrent PostgreSQL lock wait observed`);
  return results;
}
const actor='fa710000-0000-4000-8000-000000000001';
const facility='fa710001-0000-4000-8000-000000000001';
const other='fa710001-0000-4000-8000-000000000002';
const coupon='fa710003-0000-4000-8000-000000000001';
const menuA='fa710002-0000-4000-8000-000000000001';
const menuB='fa710002-0000-4000-8000-000000000002';
const save=(name,menu)=>`SET ROLE service_role; SELECT count(*) FROM public.save_admin_coupon_atomic('${actor}','${facility}','${coupon}','{"name":"${name}"}',ARRAY['${menu}'::uuid]);`;
let seeded=false;
try {
 assert.equal(query('SELECT current_database()'),database);
 assert.equal(query("SELECT current_setting('server_version_num')::int/10000"),'17');
 assert.equal(query(`SELECT count(*) FROM auth.users WHERE id='${actor}'`),'0');
 query(`BEGIN;
 INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${actor}','coupon-management-race@example.invalid',now());
 INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES
 ('${facility}','Synthetic A','synthetic-coupon-management-a','その他','検証県','検証市','検証住所','draft'),
 ('${other}','Synthetic B','synthetic-coupon-management-b','その他','検証県','検証市','検証住所','draft');
 INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('${actor}','${facility}','owner');
 INSERT INTO public.facility_menus(id,facility_id,category,name,price) VALUES('${menuA}','${facility}','その他','A',1000),('${menuB}','${facility}','その他','B',2000);
 INSERT INTO public.coupons(id,facility_id,name,discount_type,discount_value) VALUES('${coupon}','${facility}','Initial','fixed',500);
 INSERT INTO public.coupon_menus(coupon_id,menu_id) VALUES('${coupon}','${menuA}'); COMMIT;`);
 seeded=true;
 const updates=await contend('consistent-update',`SELECT id FROM public.coupons WHERE id='${coupon}' FOR UPDATE`,[save('A',menuA),save('B',menuB)]);
 assert.ok(updates.every(r=>r.status==='fulfilled'&&r.value==='1'));
 const final=JSON.parse(query(`SELECT jsonb_build_object('name',c.name,'menus',array_agg(m.menu_id)) FROM public.coupons c JOIN public.coupon_menus m ON m.coupon_id=c.id WHERE c.id='${coupon}' GROUP BY c.id;`));
 assert.deepEqual(final.menus,[final.name==='A'?menuA:menuB]);
 const before=query(`SELECT name FROM public.coupons WHERE id='${coupon}'`);
 const moves=await contend('menu-scope-recheck',`UPDATE public.facility_menus SET facility_id='${other}' WHERE id='${menuB}'`,[save('Foreign',menuB)]);
 assert.equal(moves[0].status,'rejected');assert.match(moves[0].reason.message,/COUPON_MENU_SCOPE_INVALID/);
 assert.equal(query(`SELECT name FROM public.coupons WHERE id='${coupon}'`),before);
 const roles=await contend('membership-recheck',`UPDATE public.facility_members SET role='staff' WHERE facility_id='${facility}' AND user_id='${actor}'`,[save('Revoked',menuA)]);
 assert.equal(roles[0].status,'rejected');assert.match(roles[0].reason.message,/COUPON_ACCESS_DENIED/);
 assert.equal(query(`SELECT name FROM public.coupons WHERE id='${coupon}'`),before);
 console.log('coupon management: consistent parallel save, current menu scope and role revocation verified');
} finally {
 for(const child of children)child.kill('SIGTERM');
 if(seeded)query(`BEGIN; DELETE FROM public.facility_profiles WHERE id IN ('${facility}','${other}'); DELETE FROM auth.users WHERE id='${actor}'; COMMIT;`);
}
