// Real disposable PostgreSQL transactions + a local HTTP provider. No real
// Google traffic, production credentials, customer calendars or notifications.
import assert from 'node:assert/strict';
import { execFileSync, execFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
const require=createRequire(import.meta.url);
const local=process.argv[2]==='--local-shadow';
const database=local?'carelink_shadow_calendar_20261016':'carelink_shadow';
if(!local) {assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.CI,'true');assert.ok(['localhost','127.0.0.1'].includes(process.env.PGHOST));assert.equal(process.env.PGPORT,'5432');assert.equal(process.env.PGUSER,'postgres');assert.ok(!process.env.PGSERVICE&&!process.env.PGSERVICEFILE&&!process.env.PGHOSTADDR);}
const command='psql';const args=['-X','-qAt','-v','ON_ERROR_STOP=1','-d',database];
const querySync=sql=>execFileSync(command,args,{input:sql,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:30000}).trim();
async function query(sql) {
 return new Promise((resolve,reject)=>{const child=execFile(command,args,{encoding:'utf8',timeout:30000},(error,stdout)=>error?reject(new Error('DISPOSABLE_SQL_FAILED')):resolve(stdout.trim()));child.stdin.end(sql);});
}
assert.match(querySync('SELECT current_database()'),/^carelink_shadow/);
querySync(readFileSync('supabase/shadow/calendar-operation-fixtures.sql','utf8'));
const actor='fc160000-0000-4000-8000-000000000001';const booking='fc160002-0000-4000-8000-000000000001';const token='fc160003-0000-4000-8000-000000000001';
const quote=value=>value===null?'NULL':typeof value==='object'?"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb":"'"+String(value).replaceAll("'","''")+"'";
const allowed=new Set(['inspect_calendar_operation','prepare_calendar_operation','start_calendar_operation','finish_calendar_operation']);
let loseFinish=false;let loseStart=false;let changeToken=false;let raceMapping=false;
const admin={rpc:async(name,parameters)=>{
 assert.ok(allowed.has(name));
 try {
  if(name==='finish_calendar_operation'&&raceMapping){raceMapping=false;await query("UPDATE public.booking_calendar_events SET synced_at=synced_at+interval '1 second'");}
  const sql=`SET application_name='calendar-protocol-${name}'; SET ROLE service_role; SELECT public.${name}(${Object.entries(parameters).map(([k,v])=>`${k}=>${quote(v)}`).join(',')});`;
  const text=await query(sql);const data=JSON.parse(text.split('\n').at(-1));
  if(name==='finish_calendar_operation'&&loseFinish){loseFinish=false;throw new Error('synthetic finish response lost after commit');}
  if(name==='prepare_calendar_operation'&&changeToken){changeToken=false;await query("UPDATE public.google_calendar_tokens SET updated_at='2026-02-01T00:00:00Z'");}
  if(name==='start_calendar_operation'&&loseStart){loseStart=false;throw new Error('synthetic start response lost after commit');}
  return {data,error:null};
 } catch {return {data:null,error:{code:'08006',message:'synthetic transport or transaction failure'}};}
}};
// Execute the real TS business module, replacing monitoring only (never the DB).
const ts=require('typescript');const compiled=ts.transpileModule(readFileSync('src/lib/calendar-sync-operation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
new Function('require','module','exports',compiled)(name=>name==='./safe'?{safeCaptureException:()=>{}}:name==='./alert'?{alertCaughtError:()=>{}}:name==='./database-diagnostic'?{databaseDiagnostic:()=>new Error('DATABASE_FAILURE')}:require(name),module,module.exports);
const {runCalendarOperation}=module.exports;
const events=new Map();const counts={POST:0,PUT:0,DELETE:0,GET:0};let primary='calendar-owner@example.invalid';let loseCreate=false;let loseDelete=false;let loseUpdate=false;let failDelete=false;let holdCreate=null;let createEntered=null;let providerMalformed=false;
const server=createServer(async(req,res)=>{
 assert.equal(req.headers.authorization,'Bearer synthetic-access');
 let raw='';for await(const chunk of req)raw+=chunk;
 const url=new URL(req.url,'http://localhost');const path=url.pathname;
 counts[req.method]++;
 const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(value===undefined?undefined:JSON.stringify(value));};
 if(path==='/calendar/v3/calendars/primary')return send(200,{id:primary});
 const id=decodeURIComponent(path.split('/').at(-1));
 if(req.method==='POST') {
  const body=JSON.parse(raw);assert.match(body.id,/^[a-v0-9]{5,1024}$/);if(events.has(body.id))return send(409,{error:{errors:[{reason:'duplicate'}]}});
  events.set(body.id,{...body,status:'confirmed'});
  createEntered?.();if(holdCreate)await holdCreate;
  if(loseCreate){loseCreate=false;req.socket.destroy();return;}
  return send(200,providerMalformed?{id:'different-id'}:events.get(body.id));
 }
 if(req.method==='GET')return events.get(id)?.status==='gone'?send(410,{error:{errors:[{reason:'deleted'}]}}):events.has(id)?send(200,events.get(id)):send(404,{error:{errors:[{reason:'notFound'}]}});
 if(req.method==='PUT') {if(!events.has(id))return send(404,{});events.set(id,{...JSON.parse(raw),id,status:'confirmed'});if(loseUpdate){loseUpdate=false;req.socket.destroy();return;}return send(200,events.get(id));}
 if(req.method==='DELETE') {
  if(failDelete)return send(403,{error:{errors:[{reason:'forbidden'}]}});
  if(!events.has(id))return send(404,{});
  events.set(id,{id,status:'cancelled'});
  if(loseDelete){loseDelete=false;req.socket.destroy();return;}
  return send(204);
 }
 send(500,{});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const originalFetch=globalThis.fetch;const port=server.address().port;
globalThis.fetch=(url,options)=>{assert.ok(String(url).startsWith('https://www.googleapis.com/calendar/v3/'));return originalFetch(String(url).replace('https://www.googleapis.com',`http://127.0.0.1:${port}`),options);};
const payload={summary:'Synthetic calendar event',description:'Synthetic only',location:'Synthetic',start:{dateTime:'2030-01-07T10:00:00Z',timeZone:'Asia/Tokyo'},end:{dateTime:'2030-01-07T11:00:00Z',timeZone:'Asia/Tokyo'},reminders:{useDefault:false,overrides:[]}};
async function observeOverlap(work,stage='prepare_calendar_operation') {
 const coordinator=spawn(command,args,{stdio:['pipe','pipe','pipe']});let output='';let closed=false;
 const done=new Promise((resolve,reject)=>{coordinator.stdout.on('data',chunk=>output+=chunk);coordinator.stderr.resume();coordinator.on('error',reject);coordinator.on('close',code=>{closed=true;code===0?resolve():reject(new Error('coordinator failed'))});});
 done.catch(()=>{});
 try {
  coordinator.stdin.write(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('carelink-calendar:${actor}:${booking}',0)); SELECT 'calendar-locked';\n`);
  let deadline=Date.now()+20000;while(!output.includes('calendar-locked')){if(closed||Date.now()>deadline)throw new Error('coordinator unavailable');await new Promise(r=>setTimeout(r,20));}
  const pending=work();pending.catch(()=>{});let observed=false;deadline=Date.now()+20000;
  while(Date.now()<deadline){const count=Number(querySync(`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='calendar-protocol-${stage}' AND state='active' AND wait_event_type='Lock'`));if(count>=2){observed=true;break;}await new Promise(r=>setTimeout(r,20));}
  assert.equal(observed,true,'two PostgreSQL lock waiters must overlap');coordinator.stdin.end('COMMIT;');await done;return await pending;
 } finally {if(!closed)coordinator.kill('SIGTERM');}
}
const input=(id=randomUUID(),kind='sync')=>({operationId:id,userId:actor,bookingId:booking,kind,payload:kind==='sync'?payload:{},credentials:async()=>({accessToken:'synthetic-access',tokenId:token,updatedAt:'2026-01-01T00:00:00Z'})});
const call=(request)=>runCalendarOperation(admin,request);
const body=async res=>({status:res.status,body:await res.json()});
const activeCount=()=>Number(querySync("SELECT count(*) FROM public.calendar_sync_operations WHERE state<>'succeeded'"));
const mapCount=()=>Number(querySync('SELECT count(*) FROM public.booking_calendar_events'));
const verified=[];
async function removeCurrent() {const result=await call(input(randomUUID(),'delete'));assert.equal(result.status,200);assert.equal(mapCount(),0);return result;}
try {
 // Hold Google acceptance while another process requests DELETE. No lease takeover.
 let release;let entered;const enteredPromise=new Promise(r=>entered=r);holdCreate=new Promise(r=>release=r);createEntered=entered;
 const first=input();const pending=call(first);await enteredPromise;
 const beforeDelete=counts.DELETE;const blocked=await call(input(randomUUID(),'delete'));assert.equal(blocked.status,409);assert.equal(counts.DELETE,beforeDelete);
 release();holdCreate=null;createEntered=null;assert.equal((await pending).status,200);verified.push('pending create excludes concurrent delete');
 // Existing-event updates have the same persisted intent/reconciliation rules.
 const updated=input();loseUpdate=true;const beforePut=counts.PUT;assert.equal((await call(updated)).status,503);assert.equal((await call(updated)).status,200);assert.equal(counts.PUT,beforePut+1);assert.equal(mapCount(),1);verified.push('lost update response reconciles without repeating PUT');
 const stale=input();raceMapping=true;assert.equal((await call(stale)).status,503);assert.equal(activeCount(),1);const pendingRow=JSON.parse(querySync(`SELECT to_jsonb(o) FROM public.calendar_sync_operations o WHERE id=${quote(stale.operationId)}`));
 const noRepeatPut=counts.PUT;assert.equal((await call(stale)).status,503);assert.equal(counts.PUT,noRepeatPut);querySync(`UPDATE public.booking_calendar_events SET synced_at=${quote(pendingRow.mapping_synced_at)}`);assert.equal((await call(stale)).status,200);verified.push('mapping CAS conflict never overwrites a changed row or repeats provider write');
 await removeCurrent();
 // Two independent requests and operation IDs race through real advisory locks.
 const n=counts.POST;const same=input();const simultaneous=await Promise.all([call(same),call({...same})]);assert.equal(counts.POST,n+1);assert.ok(simultaneous.some(r=>r.status===200));assert.equal((await call(same)).status,200);assert.equal(mapCount(),1);verified.push('same operation parallel create once');
 await removeCurrent();
 const n2=counts.POST;const different=await observeOverlap(()=>Promise.all([call(input()),call(input())]));assert.equal(counts.POST,n2+1);assert.equal(mapCount(),1);assert.ok(different.some(r=>r.status===200));verified.push('different operation IDs serialize first create, two DB lock waiters observed');
 await removeCurrent();
 loseCreate=true;const lost=input();const n3=counts.POST;assert.equal((await call(lost)).status,503);assert.equal(mapCount(),0);assert.equal(activeCount(),1);
 let bookingRetirementBlocked=false;try{querySync(`BEGIN; DELETE FROM public.bookings WHERE id=${quote(booking)}; ROLLBACK;`);}catch(error){bookingRetirementBlocked=String(error.stderr).includes('CALENDAR_OPERATION_PENDING');}assert.equal(bookingRetirementBlocked,true);assert.equal(activeCount(),1);verified.push('booking deletion cannot erase an unresolved external intent');
 let retirementBlocked=false;try{querySync(`BEGIN; DELETE FROM auth.users WHERE id=${quote(actor)}; COMMIT;`);}catch(error){retirementBlocked=String(error.stderr).includes('CALENDAR_OPERATION_PENDING');}assert.equal(retirementBlocked,true);assert.equal(querySync(`SELECT count(*) FROM public.google_calendar_tokens WHERE user_id=${quote(actor)}`),'1');verified.push('retirement rolls back credential cleanup and preserves unknown intent');
 assert.equal((await call(lost)).status,200);assert.equal(counts.POST,n3+1);assert.equal(mapCount(),1);verified.push('lost create response reconciles by GET, no second create');
 const deletes=counts.DELETE;
 await removeCurrent();
 // DB fails after the provider commit. Keep intent/event, never compensate blindly.
 querySync("CREATE FUNCTION public.synthetic_calendar_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic persist failure'; END $$; CREATE TRIGGER synthetic_calendar_fail BEFORE INSERT ON public.booking_calendar_events FOR EACH ROW EXECUTE FUNCTION public.synthetic_calendar_fail();");
 const dbFail=input();const nc=counts.POST;const nd=counts.DELETE;assert.equal((await call(dbFail)).status,503);assert.equal(mapCount(),0);assert.equal(activeCount(),1);assert.equal(counts.DELETE,nd);
 querySync('DROP TRIGGER synthetic_calendar_fail ON public.booking_calendar_events; DROP FUNCTION public.synthetic_calendar_fail();');
 assert.equal((await call(dbFail)).status,200);assert.equal(counts.POST,nc+1);assert.equal(counts.DELETE,nd);verified.push('tracking failure preserves intent and reconciles without DELETE');
 await removeCurrent();
 loseFinish=true;const finishLost=input();const nf=counts.POST;assert.equal((await call(finishLost)).status,503);assert.equal(mapCount(),1);const g=counts.GET;assert.equal((await call(finishLost)).status,200);assert.equal(counts.GET,g);assert.equal(counts.POST,nf+1);verified.push('lost DB commit acknowledgement returns immutable completed receipt');
 // Preserve an unknown deletion and recover from a provider tombstone.
 const deleteIntent=input(randomUUID(),'delete');loseDelete=true;assert.equal((await call(deleteIntent)).status,503);assert.equal(mapCount(),1);const dc=counts.DELETE;events.set(querySync('SELECT google_event_id FROM public.booking_calendar_events'),{status:'gone'});assert.equal((await call(deleteIntent)).status,200);assert.equal(counts.DELETE,dc);assert.equal(mapCount(),0);verified.push('lost DELETE response reconciles explicit 410 deleted after tombstone removal');
 const next=input();assert.equal((await call(next)).status,200);const newEvent=querySync('SELECT google_event_id FROM public.booking_calendar_events');const beforeOldDelete={...counts};assert.equal((await call(deleteIntent)).status,200);assert.deepEqual(counts,beforeOldDelete);assert.equal(querySync('SELECT google_event_id FROM public.booking_calendar_events'),newEvent);verified.push('stale DELETE retry cannot remove a newly synced event');
 // Replayed old sync must not overwrite a new edit or resurrect a deleted generation.
 const puts=counts.PUT;assert.equal((await call(finishLost)).status,200);assert.equal(counts.PUT,puts);assert.equal(querySync('SELECT google_event_id FROM public.booking_calendar_events'),newEvent);verified.push('completed sync replay does not mutate later generation');
 primary='different-owner@example.invalid';const change=await call(input());assert.equal(change.status,409);primary='calendar-owner@example.invalid';verified.push('different Google primary cannot mutate an existing mapping');
 await removeCurrent();
 // Confirmed provider errors and non-proof must remain unknown, not create again.
 providerMalformed=true;const malformed=input();const nm=counts.POST;assert.equal((await call(malformed)).status,503);providerMalformed=false;assert.equal((await call(malformed)).status,200);assert.equal(counts.POST,nm+1);verified.push('unconfirmed response id resolves only with matching provider proof');
 failDelete=true;const denied=input(randomUUID(),'delete');assert.equal((await call(denied)).status,503);assert.equal(mapCount(),1);assert.equal((await call(input())).status,409);failDelete=false;
 // A later explicit reconciliation sees an active event, so still no new DELETE.
 const deniedCount=counts.DELETE;assert.equal((await call(denied)).status,503);assert.equal(counts.DELETE,deniedCount);verified.push('denied deletion remains pending, no blind retry or recreation');
 const eid=querySync('SELECT google_event_id FROM public.booking_calendar_events');events.set(eid,{id:eid,status:'cancelled'});assert.equal((await call(denied)).status,200);assert.equal(mapCount(),0);
 const noop=input(randomUUID(),'delete');const noCalls={...counts};assert.equal((await call(noop)).status,200);assert.deepEqual(counts,noCalls);assert.equal((await call(input())).status,200);assert.equal((await call(noop)).status,200);assert.equal(mapCount(),1);verified.push('completed no-op deletion cannot erase later create');
 await removeCurrent();
 // Reconnect is safe only before a create has ever received a dispatch grant.
 const reconnect=input();const reserved=await admin.rpc('prepare_calendar_operation',{p_id:reconnect.operationId,p_actor:actor,p_booking:booking,p_kind:'sync',p_payload:payload,p_calendar:primary,p_token_id:token,p_token_updated_at:'2026-01-01T00:00:00Z'});assert.equal(reserved.error,null);const originalPrimary=primary;primary='new-owner@example.invalid';const rebind=await admin.rpc('prepare_calendar_operation',{p_id:reconnect.operationId,p_actor:actor,p_booking:booking,p_kind:'sync',p_payload:payload,p_calendar:primary,p_token_id:token,p_token_updated_at:'2026-01-01T00:00:00Z'});assert.equal(rebind.error,null);const oldGrant=await admin.rpc('start_calendar_operation',{p_id:reconnect.operationId,p_actor:actor,p_calendar:originalPrimary,p_token_id:token,p_token_updated_at:'2026-01-01T00:00:00Z'});assert.equal(oldGrant.data.state,'connection_changed');verified.push('old request cannot take a dispatch grant after prepared primary rebind');const rebindCreates=counts.POST;assert.equal((await call(reconnect)).status,200);assert.equal(counts.POST,rebindCreates+1);assert.equal(querySync('SELECT calendar_id FROM public.booking_calendar_events'),primary);assert.equal(querySync('SELECT google_event_id FROM public.booking_calendar_events'),reserved.data.google_event_id);await removeCurrent();primary=originalPrimary;verified.push('undispatched prepared create can rebind to a newly connected primary');
 changeToken=true;const revision=input();const tokenWrites=counts.POST;assert.equal((await call(revision)).status,409);assert.equal(counts.POST,tokenWrites);
 const newRevision={...revision,credentials:async()=>({accessToken:'synthetic-access',tokenId:token,updatedAt:'2026-02-01T00:00:00Z'})};assert.equal((await call(newRevision)).status,200);querySync("UPDATE public.google_calendar_tokens SET updated_at='2026-01-01T00:00:00Z'");verified.push('credential revision change prevents stale dispatch and permits same-primary recovery');
 await removeCurrent();
 loseStart=true;const unstarted=input();const ns=counts.POST;assert.equal((await call(unstarted)).status,503);primary='new-owner@example.invalid';assert.equal((await call(unstarted)).status,409);primary='calendar-owner@example.invalid';verified.push('started unknown operation cannot rebind or dispatch under a new primary');assert.equal((await call(unstarted)).status,503);assert.equal(counts.POST,ns);assert.equal(activeCount(),1);verified.push('lost start acknowledgement cannot authorize another dispatch');
 // Only external evidence can resolve the unknown start; never timeout takeover.
 const r=JSON.parse(querySync(`SELECT to_jsonb(o) FROM public.calendar_sync_operations o WHERE id=${quote(unstarted.operationId)}`));events.set(r.google_event_id,{...r.payload,id:r.google_event_id,status:'confirmed',extendedProperties:{private:{carelinkOperation:r.id}}});assert.equal((await call(unstarted)).status,200);
 await removeCurrent();
 const contested=input();const initial=await admin.rpc('prepare_calendar_operation',{p_id:contested.operationId,p_actor:actor,p_booking:booking,p_kind:'sync',p_payload:payload,p_calendar:primary,p_token_id:token,p_token_updated_at:'2026-01-01T00:00:00Z'});assert.equal(initial.error,null);
 const starters=await observeOverlap(()=>Promise.all([admin.rpc('start_calendar_operation',{p_id:contested.operationId,p_actor:actor,p_calendar:primary,p_token_id:token,p_token_updated_at:'2026-01-01T00:00:00Z'}),admin.rpc('start_calendar_operation',{p_id:contested.operationId,p_actor:actor,p_calendar:primary,p_token_id:token,p_token_updated_at:'2026-01-01T00:00:00Z'})]),'start_calendar_operation');assert.equal(starters.filter(x=>x.data.dispatch===true).length,1);
 events.set(initial.data.google_event_id,{...payload,id:initial.data.google_event_id,status:'confirmed',extendedProperties:{private:{carelinkOperation:contested.operationId}}});assert.equal((await call(contested)).status,200);verified.push('two simultaneous SQL dispatch claims authorize exactly one writer');
 // No provider write was authorized for a prepared receipt. It must not strand
 // retirement after a failed credential read or abandoned browser request.
 const undispatched=input();const undispatchedPrepared=await admin.rpc('prepare_calendar_operation',{p_id:undispatched.operationId,p_actor:actor,p_booking:booking,p_kind:'sync',p_payload:payload,p_calendar:primary,p_token_id:token,p_token_updated_at:'2026-01-01T00:00:00Z'});assert.equal(undispatchedPrepared.data.state,'prepared');
 const noRetirementWrites={...counts};
 querySync(`BEGIN; SET ROLE service_role; DELETE FROM public.bookings WHERE id=${quote(booking)}; ROLLBACK;`);
 assert.equal(querySync(`SELECT state FROM public.calendar_sync_operations WHERE id=${quote(undispatched.operationId)}`),'prepared');assert.deepEqual(counts,noRetirementWrites);verified.push('booking retirement permits undispatched preparation; rollback restores its receipt');
 // Simulate the limited Auth role, not the migration owner, for successful retirement.
 const authRole=`carelink_calendar_fixture_auth_${process.pid}`;querySync(`CREATE ROLE ${authRole} NOLOGIN; GRANT USAGE ON SCHEMA auth TO ${authRole}; GRANT SELECT,DELETE ON auth.users TO ${authRole}; GRANT ${authRole} TO postgres;`);
 try{querySync(`SET ROLE ${authRole}; DELETE FROM auth.users WHERE id=${quote(actor)};`);assert.equal(querySync(`SELECT count(*) FROM public.profiles WHERE id=${quote(actor)}`),'0');assert.equal(querySync(`SELECT count(*) FROM public.calendar_sync_operations WHERE actor_id=${quote(actor)}`),'0');assert.deepEqual(counts,noRetirementWrites);verified.push('limited Auth role retires with undispatched preparation and no provider calls or extra privileges');}
 finally{querySync(`REVOKE SELECT,DELETE ON auth.users FROM ${authRole}; REVOKE USAGE ON SCHEMA auth FROM ${authRole}; DROP ROLE ${authRole};`);}
 // Auth retirement anonymizes bookings instead of deleting them. Remove only
 // this script's synthetic fixtures so later disposable-DB suites start clean.
 querySync(`DELETE FROM public.bookings WHERE id=${quote(booking)}; DELETE FROM public.facility_profiles WHERE id='fc160001-0000-4000-8000-000000000001'; DELETE FROM auth.users WHERE id='fc160000-0000-4000-8000-000000000002';`);
 assert.equal(querySync(`SELECT count(*) FROM public.bookings WHERE id=${quote(booking)}`),'0');
 console.log(JSON.stringify({database,verified,providerMutations:counts,allPassed:true,fixturesCleaned:true,productionTraffic:false},null,2));
} finally {globalThis.fetch=originalFetch;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
