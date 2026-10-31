import { isolatedStack } from './assert-local-stack.mjs';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { randomUUID, randomBytes } from 'node:crypto';
const e = isolatedStack();
const api = new URL(e.API_URL); if (api.hostname !== '127.0.0.1' && api.hostname !== 'localhost') throw Error('Refusing nonlocal Supabase');
const base='http://127.0.0.1:18744';
const admin=createClient(api.href,e.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const token=randomUUID().slice(0,8); const email=`cf-${token}@example.invalid`, password=randomBytes(24).toString('hex');
const user=await admin.auth.admin.createUser({email,password,email_confirm:true}); if(user.error) throw Error('Local user creation failed: '+user.error.message);
async function insert(table, values) { const r=await admin.from(table).insert(values).select('id').single(); if(r.error)throw Error(table+' setup failed: '+r.error.message);return r.data.id; }
const ids=[];
for(const n of ['a','b']) ids.push(await insert('facility_profiles',{name:`合成施設${n}`,slug:`cf-${token}-${n}`,business_type:'ヘアサロン',prefecture:'東京都',city:'テスト市',address:'テスト住所',status:'draft'}));
const m=await admin.from('facility_members').insert({facility_id:ids[0],user_id:user.data.user.id,role:'owner'}); if(m.error) throw Error('local membership setup failed: '+m.error.message);
const jar=new Map(); const client=createServerClient(api.href,e.ANON_KEY,{cookies:{getAll(){return [...jar].map(([name,value])=>({name,value}))},setAll(v){for(const x of v)jar.set(x.name,x.value)}}});
const signed=await client.auth.signInWithPassword({email,password}); if(signed.error)throw Error('local authentication failed: '+signed.error.message);
const cookie=[...jar].map(([n,v])=>`${n}=${v}`).join('; ');
for(const [label,id,want] of [['own',ids[0],200],['other',ids[1],403]]) {const response=await fetch(`${base}/api/admin/bookings/recent?facility_id=${id}`,{headers:{cookie},redirect:'manual'});console.log(`${label} facility HTTP ${response.status} (expected ${want})`);if(response.status!==want) {let x=await response.text();console.log('response classification:',x.slice(0,200)); process.exitCode=1;}}
const second=await admin.from('facility_members').insert({facility_id:ids[1],user_id:user.data.user.id,role:'admin'});if(second.error)throw Error('second membership setup failed: '+second.error.message);
let res=await fetch(`${base}/api/admin/bookings/recent`,{headers:{cookie},redirect:'manual'});console.log(`multiple facilities without selection HTTP ${res.status} (expected 400)`);if(res.status!==400)process.exitCode=1;
res=await fetch(`${base}/api/admin/bookings/recent?facility_id=${ids[1]}`,{headers:{cookie},redirect:'manual'});console.log(`second granted facility HTTP ${res.status} (expected 200)`);if(res.status!==200)process.exitCode=1;
const del=await admin.from('facility_members').delete().eq('facility_id',ids[1]).eq('user_id',user.data.user.id);if(del.error)throw Error('membership revoke failed');
res=await fetch(`${base}/api/admin/bookings/recent?facility_id=${ids[1]}`,{headers:{cookie},redirect:'manual'});console.log(`revoked membership with existing session HTTP ${res.status} (expected 403)`);if(res.status!==403)process.exitCode=1;
