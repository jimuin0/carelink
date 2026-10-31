import { isolatedStack } from './assert-local-stack.mjs';
import {chromium,webkit,devices} from 'playwright';import {createClient} from '@supabase/supabase-js';import {randomUUID} from 'node:crypto';
const browserName=process.env.CARELINK_LOCAL_BROWSER||'chromium';if(!['chromium','webkit'].includes(browserName))throw Error('unsupported local browser');
let e=isolatedStack();const u=new URL(e.API_URL);if(!['localhost','127.0.0.1','::1'].includes(u.hostname))throw Error('refusing nonlocal db');const useLocalHttps=process.env.CARELINK_LOCAL_HTTPS==='1';const app=useLocalHttps?'https://127.0.0.1:18747':'http://127.0.0.1:18744';const db=createClient(u.href,e.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const suffix=randomUUID().slice(0,8);
async function insert(t,v) {const x=await db.from(t).insert(v).select('id').single();if(x.error)throw Error(`fixture ${t} failed: ${x.error.message}`);return x.data.id;}
const hours=Object.fromEntries(['mon','tue','wed','thu','fri','sat','sun'].map(d=>[d,{open:'09:00',close:'20:00'}]));
const facility=await insert('facility_profiles',{name:'合成予約検証店',slug:'cf-booking-'+suffix,business_type:'ヘアサロン',prefecture:'東京都',city:'テスト市',address:'テスト住所',status:'draft',business_hours:hours});
const staff=await insert('staff_profiles',{facility_id:facility,name:'合成スタッフ',slug:'cf-staff-'+suffix,sort_order:1,is_active:true});
let r=await db.from('staff_schedules').insert(Array.from({length:7},(_,day)=>({staff_id:staff,day_of_week:day,start_time:'09:00',end_time:'20:00'})));if(r.error)throw Error('schedule fixture failed: '+r.error.message);
const menu=await insert('facility_menus',{facility_id:facility,category:'カット',name:'合成メニュー',price:8000,duration_minutes:60,is_published:true});
r=await db.from('facility_photos').insert({facility_id:facility,photo_url:app+'/icons/icon-192.png',photo_type:'other'});if(r.error)throw Error('photo fixture failed: '+r.error.message);
r=await db.from('facility_profiles').update({status:'published'}).eq('id',facility);if(r.error)throw Error('publish synthetic fixture failed');
r=await db.rpc('facility_booking_ready',{p_facility_id:facility});if(r.error||r.data!==true)throw Error('synthetic facility not ready');
const browser=await (browserName==='webkit'?webkit:chromium).launch({headless:true});const context=await browser.newContext({...browserName==='webkit'?devices['iPhone 13']:{},serviceWorkers:'block',ignoreHTTPSErrors:useLocalHttps});let blocked=0;const allowed=new Set([app,u.origin]);await context.route('**/*',route=>{let url;try{url=new URL(route.request().url())}catch{return route.abort()};if(allowed.has(url.origin))return route.continue();blocked++;return route.abort();});const page=await context.newPage();
let phase='open';try {
 await page.goto(app+'/facility/cf-booking-'+suffix+'/booking',{waitUntil:'domcontentloaded'});
 phase='select menu';
 await page.getByRole('button',{name:/合成メニュー/}).click({timeout:15000});
 phase='open date selection';
 await page.getByRole('button',{name:'次へ（日時を選ぶ）'}).click();
 phase='select available slot';
 const available=page.locator('table button:not([disabled])').first();await available.waitFor({timeout:15000});await available.click();
 phase='open confirmation';
 await page.getByRole('button',{name:'次へ（確認・予約）'}).click();
 phase='fill contact';
 await page.locator('#booking-name').fill('合成利用者');await page.locator('#booking-email').fill('booking@example.invalid');
 phase='submit booking';
 const responsePromise=page.waitForResponse(r=>r.url().includes('/api/booking')&&r.request().method()==='POST'&&r.request().headers()['x-booking-action']==='create',{timeout:20000});
 await page.getByRole('button',{name:'この内容で予約する'}).click();const response=await responsePromise;const result=await response.json();
 if(response.status()!==200||result.state!=='accepted'||!result.bookingId)throw Error('booking response not accepted');await page.waitForURL('**/booking/complete**',{timeout:15000});
 const stored=await db.from('bookings').select('id',{count:'exact'}).eq('facility_id',facility);if(stored.error||stored.count!==1||stored.data[0]?.id!==result.bookingId)throw Error('synthetic booking persistence failed');
 console.log(`synthetic ${browserName} booking: accepted, stored once, completion displayed`);console.log('external requests blocked:',blocked);
} catch(e){console.log('synthetic browser booking failed:',e.name,'phase:',phase);console.log('local page path:',new URL(page.url()).pathname);process.exitCode=1}finally{await browser.close()}
