// Real lock-contention acceptance; synthetic rows in the disposable CI database only.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
assert.equal(process.env.CI,'true');assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.ok(['localhost','127.0.0.1'].includes(process.env.PGHOST));assert.equal(process.env.PGPORT,'5432');
assert.equal(process.env.PGUSER,'postgres');assert.ok(process.env.PGPASSWORD);
assert.ok(!process.env.PGSERVICE&&!process.env.PGSERVICEFILE&&!process.env.PGHOSTADDR);
const db='carelink_shadow';const args=['-X','-qAt','-v','ON_ERROR_STOP=1','-d',db];
const query=sql=>execFileSync('psql',args,{input:sql,encoding:'utf8',timeout:30000}).trim();
assert.equal(query('SELECT current_database()'),db);
assert.equal(query("SELECT to_regprocedure('public.line_support_job_status(text)') IS NOT NULL"),'t');
const actor='caeb0000-0000-4000-8000-000000000001';const customer='U'+'7'.repeat(32),recipient='U'+'8'.repeat(32);
const lease='caeb1000-0000-4000-8000-000000000001';const delivery='caeb2000-0000-4000-8000-000000000001';
const retry='caeb3000-0000-4000-8000-000000000001';const facts='a'.repeat(64);const prefix='line-support-'+process.pid;
const children=new Set();let owned=false;
function client(name){
 assert.match(name,/^[a-z0-9-]+$/);
 const process=spawn('psql',args,{stdio:['pipe','pipe','pipe']});children.add(process);let output='',errors='';
 const done=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{process.kill('SIGTERM');reject(new Error('support contention timeout'));},30000);
  process.stdout.on('data',part=>{output+=part;});process.stderr.on('data',part=>{errors+=part;});
  process.once('error',()=>{clearTimeout(timer);reject(new Error('support fixture client unavailable'));});
  process.once('close',code=>{clearTimeout(timer);children.delete(process);if(code===0)resolve(output.trim());else reject(new Error('support fixture SQL failed: '+errors.slice(0,300)));});
  process.stdin.on('error',()=>process.kill('SIGTERM'));
 });
 process.stdin.write(`SET application_name='${name}';\n`);return {process,done,output:()=>output};
}
const completed=[];
async function contend(label,heldSql,waitingSql){
 const holderName=prefix+'-'+label+'-holder',waiterName=prefix+'-'+label+'-waiter';
 const holder=client(holderName);const held=holder.done;held.catch(()=>{});
 holder.process.stdin.write(`BEGIN; ${heldSql}; SELECT 'locked';\n`);
 const deadline=Date.now()+20000;
 while(!holder.output().includes('locked\n')){if(Date.now()>deadline)throw new Error('support holder not ready');await new Promise(resolve=>setTimeout(resolve,20));}
 const waiter=client(waiterName);const waiting=waiter.done;waiting.catch(()=>{});waiter.process.stdin.end(waitingSql);
 while(query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity w JOIN pg_stat_activity h ON h.application_name='${holderName}'
  WHERE w.datname=current_database() AND w.application_name='${waiterName}' AND w.wait_event_type='Lock' AND h.pid=ANY(pg_blocking_pids(w.pid)))`)!=='t'){
  if(Date.now()>deadline)throw new Error('support blocker not observed');await new Promise(resolve=>setTimeout(resolve,20));
 }
 holder.process.stdin.end('COMMIT;');await held;const result=await waiting;completed.push(label);return result;
}
const accept=(id,body)=>`public.accept_line_support_event('${prefix}-${id}','${customer}','text','${prefix}-${id}-message','${body}','2030-01-01T10:00:00Z',true)`;
try{
 assert.equal(query(`SELECT count(*) FROM auth.users WHERE id='${actor}'`),'0');
 assert.equal(query(`SELECT count(*) FROM public.line_support_conversations WHERE line_user_id='${customer}'`),'0');
 query(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${actor}','line-support-race@example.invalid',now()); UPDATE public.profiles SET is_platform_admin=true WHERE id='${actor}'`);owned=true;
 query(`SELECT public.manage_line_support('${actor}','rollout','{"mode":"observe"}'); SELECT public.manage_line_support('${actor}','pair_start','{"hash":"${'b'.repeat(64)}"}');
  SELECT public.confirm_line_support_pair_candidate('${'b'.repeat(64)}','${recipient}');SELECT public.manage_line_support('${actor}','pair_confirm','{}');SELECT public.manage_line_support('${actor}','rollout','{"mode":"live"}')`);
 assert.equal(await contend('event-replay',`SELECT ${accept('event','相談の原文')}`,`SELECT ${accept('event','相談の原文')}->>'status'`),'duplicate');
 assert.equal(query(`SELECT count(*) FROM public.line_support_events WHERE event_id='${prefix}-event'`),'1');
 assert.equal(await contend('exclusive-lease',`SELECT public.claim_line_support_event('${prefix}-event','${lease}') IS NOT NULL`,
  `SELECT public.claim_line_support_event('${prefix}-event','caeb1000-0000-4000-8000-000000000002') IS NULL`),'t');
 query(`SELECT public.prepare_line_support_delivery('${prefix}-event','${lease}','${delivery}','${retry}','operator_draft','${facts}','運営の確認事項','synthetic-model','コピー用の文案')`);
 assert.equal(await contend('revoked-recipient',`UPDATE public.profiles SET is_platform_admin=false WHERE id='${actor}'`,
  `SELECT public.claim_line_support_delivery('${delivery}','${facts}') IS NULL`),'t');
 assert.equal(query(`SELECT state FROM public.line_support_deliveries WHERE id='${delivery}'`),'superseded');
 query(`UPDATE public.profiles SET is_platform_admin=true WHERE id='${actor}';SELECT ${accept('followup','追記')};
  SELECT public.claim_line_support_event('${prefix}-followup','${lease}');
  SELECT public.prepare_line_support_delivery('${prefix}-followup','${lease}','caeb2000-0000-4000-8000-000000000002','caeb3000-0000-4000-8000-000000000002','operator_draft','${facts}','運営の確認事項','synthetic-model','新しい文案')`);
 assert.equal(await contend('stale-draft',`SELECT ${accept('latest','さらに追記')}`,
  `SELECT public.claim_line_support_delivery('caeb2000-0000-4000-8000-000000000002','${facts}') IS NULL`),'t');
 assert.equal(query(`SELECT body FROM public.line_support_events WHERE event_id='${prefix}-event'`),'相談の原文');
 console.log(JSON.stringify({passed:completed,observed_blockers:completed.length,provider_calls:0}));
}finally{
 for(const process of children)process.kill('SIGTERM');
 query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${db}' AND application_name LIKE '${prefix}-%' AND pid<>pg_backend_pid()`);
 if(owned)query(`BEGIN;UPDATE public.profiles SET is_platform_admin=true WHERE id='${actor}';SELECT public.manage_line_support('${actor}','unbind','{}');
  DELETE FROM public.line_support_deliveries WHERE conversation_id IN(SELECT id FROM public.line_support_conversations WHERE line_user_id='${customer}');
  DELETE FROM public.line_support_drafts WHERE conversation_id IN(SELECT id FROM public.line_support_conversations WHERE line_user_id='${customer}');
  DELETE FROM public.line_support_events WHERE conversation_id IN(SELECT id FROM public.line_support_conversations WHERE line_user_id='${customer}');
  DELETE FROM public.line_support_conversations WHERE line_user_id='${customer}';DELETE FROM auth.users WHERE id='${actor}';COMMIT;`);
}
