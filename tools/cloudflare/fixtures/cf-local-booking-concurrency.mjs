import { isolatedStack } from './assert-local-stack.mjs';
import {createClient} from '@supabase/supabase-js';import {randomUUID} from 'node:crypto';
let e=isolatedStack();const u=new URL(e.API_URL);if(!['localhost','127.0.0.1','::1'].includes(u.hostname))throw Error('refusing nonlocal db');const app='http://127.0.0.1:18744';const db=createClient(u.href,e.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const suffix=randomUUID().slice(0,8);
async function insert(t,v) {const x=await db.from(t).insert(v).select('id').single();if(x.error)throw Error(`fixture ${t} failed: ${x.error.message}`);return x.data.id;}
const hours=Object.fromEntries(['mon','tue','wed','thu','fri','sat','sun'].map(d=>[d,{open:'09:00',close:'20:00'}]));
const facility=await insert('facility_profiles',{name:'合成予約検証店',slug:'cf-booking-'+suffix,business_type:'ヘアサロン',prefecture:'東京都',city:'テスト市',address:'テスト住所',status:'draft',business_hours:hours});
const staff=await insert('staff_profiles',{facility_id:facility,name:'合成スタッフ',slug:'cf-staff-'+suffix,sort_order:1,is_active:true});
let r=await db.from('staff_schedules').insert(Array.from({length:7},(_,day)=>({staff_id:staff,day_of_week:day,start_time:'09:00',end_time:'20:00'})));if(r.error)throw Error('schedule fixture failed: '+r.error.message);
const menu=await insert('facility_menus',{facility_id:facility,category:'カット',name:'合成メニュー',price:8000,duration_minutes:60,is_published:true});
r=await db.from('facility_photos').insert({facility_id:facility,photo_url:app+'/icons/icon-192.png',photo_type:'other'});if(r.error)throw Error('photo fixture failed: '+r.error.message);
r=await db.from('facility_profiles').update({status:'published'}).eq('id',facility);if(r.error)throw Error('publish synthetic fixture failed');
r=await db.rpc('facility_booking_ready',{p_facility_id:facility});if(r.error||r.data!==true)throw Error('synthetic facility not ready');
let res=await fetch(app+'/api/booking',{method:'POST',headers:{Origin:app,'X-Booking-Action':'context'}});if(res.status!==200)throw Error('context failed '+res.status);const cookie=res.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');if(!cookie)throw Error('missing test context cookie');
const day=new Date(Date.now()+9*3600000+7*86400000).toISOString().slice(0,10);const body={facility_id:facility,staff_id:staff,menu_id:menu,coupon_id:null,booking_date:day,start_time:'10:00',end_time:'11:00',customer_name:'合成利用者',email:'booking@example.invalid',phone:null,note:null,total_price:8000,points_used:0};
async function call(action,id){const z=await fetch(app+'/api/booking',{method:'POST',headers:{Origin:app,'X-Booking-Action':action,'Idempotency-Key':id,'Content-Type':'application/json','x-real-ip':'198.18.'+(parseInt(suffix.slice(0,2),16))+'.'+(id.endsWith('0') ? '31' : '32'),cookie},body:JSON.stringify(body)});let b=await z.json();return {status:z.status,state:b.state,code:b.code,error:b.error,bookingId:b.bookingId};}
const ids=[randomUUID().slice(0,-1)+'0',randomUUID().slice(0,-1)+'1'];
for(const id of ids){const p=await call('prepare',id);if(p.status!==200||p.state!=='prepared')throw Error('prepare failed');}
const results=await Promise.all(ids.map(id=>call('create',id)));console.log('simultaneous same slot HTTP statuses:',results.map(x=>x.status).sort().join(','));if(results.filter(x=>x.status===200&&x.state==='accepted').length!==1||results.filter(x=>x.status===409).length!==1)throw Error('concurrency invariant failed');
const count=await db.from('bookings').select('id',{count:'exact',head:true}).eq('facility_id',facility);console.log('synthetic bookings count:',count.count);if(count.error||count.count!==1)throw Error('unexpected booking count');
