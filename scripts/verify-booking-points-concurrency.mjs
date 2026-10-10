// Explicit isolated PG17 gate; never selected by npm test and never contacts providers.
import { execFileSync, spawn } from 'node:child_process';
const db=process.env.CARELINK_POINTS_TEST_DB;
const host=process.env.PGHOST;
const container=process.env.CARELINK_POINTS_TEST_CONTAINER;
const localHost=host && (host.startsWith('/') || ['localhost','127.0.0.1','::1'].includes(host));
if (!localHost || (container ? container!=='supabase_db_carelink' || db!=='postgres' : !/^carelink_shadow[a-z0-9_]*$/.test(db??''))) {
  throw new Error('isolated shadow DB/loopback host or explicit CareLink local container required');
}
const command=container?'docker':'psql';
const args=container?['exec','-i',container,'psql','-U','postgres','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-d',db]
 :['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-d',db];
const sql=(input)=>execFileSync(command,args,{input,encoding:'utf8',maxBuffer:1024*1024}).trim();
const run=(input)=>new Promise((resolve,reject)=>{
 const child=spawn(command,args,{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
 child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
 child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.end(input);
});
const u='fc210000-0000-4000-8000-000000000001',a='fc210000-0000-4000-8000-000000000002';
const f='fc220000-0000-4000-8000-000000000001';
const ids=['fc230000-0000-4000-8000-000000000001','fc230000-0000-4000-8000-000000000002'];
const insert=(id,h,points)=>`INSERT INTO public.bookings(id,facility_id,user_id,booking_date,start_time,end_time,customer_name,email,status,total_price,points_used)
 VALUES('${id}','${f}','${u}','2030-01-07','${h}:00','${h+1}:00','Synthetic',NULL,'confirmed',400,${points});`;
let created=false;
const assert=(ok,label)=>{if(!ok)throw new Error(`point concurrency gate: ${label}`);};
try {
 const stats=JSON.parse(sql("SELECT json_build_object('v',current_setting('server_version_num')::int,'auth',(SELECT count(*) FROM auth.users));"));
 assert(stats.v>=170000&&stats.v<180000,'actual PG17 required');
 if(container)assert(stats.auth===0,'local container has no existing accounts before committed synthetic fixture');
 sql(`BEGIN;INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${u}','points-concurrent-user@example.invalid',now()),('${a}','points-concurrent-owner@example.invalid',now());
 INSERT INTO public.facility_profiles(id,name,slug,business_type,prefecture,city,address,status) VALUES('${f}','Synthetic concurrency','points-concurrency','その他','検証県','検証市','検証住所','draft');
 INSERT INTO public.facility_members(user_id,facility_id,role) VALUES('${a}','${f}','owner');
 INSERT INTO public.user_points(user_id,points,reason) VALUES('${u}',1000,'Synthetic concurrency seed');COMMIT;`);created=true;
 const outcomes=await Promise.all(ids.map((id,i)=>run(`BEGIN;SET LOCAL ROLE service_role;SELECT public.lock_booking_account('${u}');SELECT pg_sleep(1);${insert(id,10+i*2,600)}COMMIT;`)));
 assert(outcomes.filter(r=>r.code===0).length===1&&outcomes.filter(r=>r.stderr.includes('POINTS_INSUFFICIENT')).length===1,'two competing spends produce one booking, one rejected transaction');
 let result=JSON.parse(sql(`SELECT json_build_object('balance',(SELECT sum(points) FROM public.user_points WHERE user_id='${u}'),'bookings',(SELECT count(*) FROM public.bookings WHERE facility_id='${f}'));`));
 assert(result.balance===400&&result.bookings===1,'no negative balance or orphan reservation');
 const bid=sql(`SELECT id FROM public.bookings WHERE facility_id='${f}';`);
 const completed=await Promise.all([0,1].map(()=>run(`BEGIN;SET LOCAL ROLE service_role;SELECT * FROM public.complete_booking_with_points_atomic('${a}','${bid}','confirmed');SELECT pg_sleep(0.2);COMMIT;`)));
 assert(completed.every(r=>r.code===0)&&completed.filter(r=>r.stdout.includes('|f')).length===1&&completed.filter(r=>r.stdout.includes('|t')).length===1,'two completion callers award once; loser confirms saved replay');
 result=JSON.parse(sql(`SELECT json_build_object('awards',(SELECT count(*) FROM public.user_points WHERE booking_id='${bid}' AND booking_operation='award'),'visits',(SELECT count(*) FROM public.customer_visits WHERE booking_id='${bid}'));`));
 assert(result.awards===1&&result.visits===1,'completion preserves one award and visit');
 sql(`BEGIN;SET LOCAL ROLE service_role;SELECT * FROM public.save_booking_email_event_atomic('${a}','${bid}','completed',(SELECT updated_at FROM public.bookings WHERE id='${bid}'),'no_show',NULL);
 SELECT * FROM public.save_booking_email_event_atomic('${a}','${bid}','no_show',(SELECT updated_at FROM public.bookings WHERE id='${bid}'),'cancelled',NULL);COMMIT;`);
 const cancelId='fc230000-0000-4000-8000-000000000003';sql(`BEGIN;SET LOCAL ROLE service_role;${insert(cancelId,16,500)}COMMIT;`);
 const cancelled=await Promise.all([0,1].map(()=>run(`BEGIN;SET LOCAL ROLE service_role;SELECT * FROM public.cancel_booking_with_points_atomic('${u}','${cancelId}','confirmed');SELECT pg_sleep(0.2);COMMIT;`)));
 assert(cancelled.filter(r=>r.code===0).length===1&&cancelled.filter(r=>r.stderr.includes('BOOKING_REVISION_CONFLICT')).length===1,'two cancellations refund once');
 result=JSON.parse(sql(`SELECT json_build_object('balance',(SELECT sum(points) FROM public.user_points WHERE user_id='${u}'),'refunds',(SELECT count(*) FROM public.user_points WHERE booking_id='${cancelId}' AND booking_operation='refund'));`));
 assert(result.balance===1000&&result.refunds===1,'final exact balance restored; no minted points');
 console.log('PG17 points concurrency passed: competing debit, completion and refund; exact ledger/visit invariants.');
} finally {
 if(created)sql(`BEGIN;DELETE FROM public.bookings WHERE facility_id='${f}';DELETE FROM public.facility_profiles WHERE id='${f}';DELETE FROM auth.users WHERE id IN('${u}','${a}');COMMIT;`);
}
