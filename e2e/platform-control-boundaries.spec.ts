import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

test.use({trace:'off',screenshot:'off',video:'off',serviceWorkers:'block'});
test.beforeAll(()=>{
 if(process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'
  ||process.env.NEXT_PUBLIC_SUPABASE_URL!=='https://localhost:54330'
  ||process.env.PLAYWRIGHT_BASE_URL!=='https://localhost:3000'
  ||!process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.RESEND_API_KEY||process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK)
  throw new Error('Platform control fixture requires managed isolated CI without provider credentials');
});
test('platform saves are confirmed, invalid booleans rejected, and revoked admin cannot write',async({page})=>{
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
 const email=`synthetic-platform-${randomUUID()}@example.invalid`,password=randomUUID();
 const identity=await db.auth.admin.createUser({email,password,email_confirm:true});
 if(identity.error||!identity.data.user)throw new Error('Synthetic platform identity unavailable');
 const actor=identity.data.user.id,fid=randomUUID(),ticket=randomUUID(),key=`synthetic_${randomUUID().replaceAll('-','')}`;
 const headers={Origin:'https://localhost:3000'};
 try{
  expect((await db.from('profiles').update({is_platform_admin:true}).eq('id',actor)).error).toBeNull();
  expect((await db.from('facility_profiles').insert({id:fid,name:'Synthetic platform control',slug:`synthetic-platform-${fid}`,business_type:'その他',prefecture:'合成県',city:'合成市',address:'合成住所',status:'draft'})).error).toBeNull();
  expect((await db.from('contacts').insert({id:ticket,name:'Synthetic control',email,inquiry_type:'other',message:'Synthetic fixture'})).error).toBeNull();
  await page.goto('/auth/login?redirect=%2Fmypage');
  await page.getByRole('button',{name:'必須のみ',exact:true}).click();
  await page.getByLabel('メールアドレス',{exact:true}).fill(email);
  await page.getByLabel('パスワード',{exact:true}).fill(password);
  await page.getByRole('button',{name:'ログイン',exact:true}).click();
  await page.waitForURL('**/mypage');
  const created=await page.request.post('/api/admin/feature-flags',{headers,data:{key,enabled:false,rollout_pct:0}});
  expect(created.status()).toBe(201);expect(created.headers()['cache-control']).toBe('no-store');
  const flag=(await created.json()).flag;expect(flag.key).toBe(key);expect(flag.enabled).toBe(false);
  const patched=await page.request.patch(`/api/admin/feature-flags/${flag.id}`,{headers,data:{rollout_pct:100}});expect(patched.status()).toBe(200);
  const persisted=await db.from('feature_flags').select('enabled,rollout_pct').eq('id',flag.id).single();expect(persisted.error).toBeNull();expect(persisted.data).toEqual({enabled:false,rollout_pct:100});
  const resolve=()=>page.request.patch(`/api/admin/inquiries/${ticket}`,{headers,data:{ticket_status:'resolved'}});
  expect((await resolve()).status()).toBe(200);
  const first=await db.from('contacts').select('resolved_at').eq('id',ticket).single();expect(first.error).toBeNull();expect(first.data?.resolved_at).not.toBeNull();
  expect((await resolve()).status()).toBe(200);
  const replay=await db.from('contacts').select('resolved_at').eq('id',ticket).single();expect(replay.error).toBeNull();expect(replay.data).toEqual(first.data);
  const invalid=await page.request.patch('/api/admin/facility-verify',{headers,data:{facility_id:fid,is_verified:'false'}});expect(invalid.status()).toBe(400);
  const before=await db.from('facility_profiles').select('is_verified').eq('id',fid).single();expect(before.error).toBeNull();expect(before.data?.is_verified).toBe(false);
  const verified=await page.request.patch('/api/admin/facility-verify',{headers,data:{facility_id:fid,is_verified:true,verified_type:'identity'}});expect(verified.status()).toBe(200);
  const badge=await db.from('facility_profiles').select('is_verified,verified_type').eq('id',fid).single();expect(badge.error).toBeNull();expect(badge.data).toEqual({is_verified:true,verified_type:'identity'});
  expect((await db.from('profiles').update({is_platform_admin:false}).eq('id',actor)).error).toBeNull();
  const denied=await page.request.patch(`/api/admin/feature-flags/${flag.id}`,{headers,data:{enabled:true}});expect(denied.status()).toBe(403);
  const unchanged=await db.from('feature_flags').select('enabled').eq('id',flag.id).single();expect(unchanged.error).toBeNull();expect(unchanged.data?.enabled).toBe(false);
 }finally{
  expect((await db.from('feature_flags').delete().eq('key',key)).error).toBeNull();
  expect((await db.from('contacts').delete().eq('id',ticket)).error).toBeNull();
  expect((await db.from('facility_profiles').delete().eq('id',fid)).error).toBeNull();
  expect((await db.auth.admin.deleteUser(actor)).error).toBeNull();
 }
});
