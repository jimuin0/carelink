/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
let mockClient: () => unknown;
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => mockClient() }));
jest.mock('@/lib/alert', () => ({ alertDeliveryFailures: jest.fn(), alertWarning: jest.fn(), alertCaughtError: jest.fn() }));
import { GET } from '@/app/api/cron/favorites-digest/route';
const statusFile = process.env.CARELINK_LOCAL_CRON_STACK_STATUS;
if (!statusFile) throw new Error('Dedicated stack status is required');
const saved = JSON.parse(readFileSync(statusFile, 'utf8'));
const root = realpathSync(saved.identity.project_root);
if (root !== '/private/tmp/carelink-cf-cron-check-20261029' || saved.runtime !== 'native') throw new Error('Unexpected local stack');
const stack = JSON.parse(execFileSync('npm', ['exec', '--yes', '--package=supabase@2.122.0', '--', 'supabase', 'stack', 'status', '--output-format', 'json'], {
 cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, SUPABASE_EXPERIMENTAL_STACK: '1' }, encoding: 'utf8', timeout: 30000, stdio: ['ignore','pipe','pipe'],
}));
const localApi = new URL(stack.env.API_URL);
if (stack.identity.id !== saved.identity.id || stack.runtime !== 'native' || !['ready','sleeping'].includes(stack.readiness) || stack.env.API_URL !== saved.env.API_URL || localApi.protocol !== 'http:' || localApi.hostname !== '127.0.0.1' || !stack.env.SERVICE_ROLE_KEY || process.env.RESEND_API_KEY || process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK) throw new Error('Isolated stack changed or delivery credentials are present');
const db = createClient(stack.env.API_URL, stack.env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const originalFetch=globalThis.fetch;
let selected='';
beforeAll(()=>{
 process.env.CRON_SECRET='synthetic-local-cron-only';
 mockClient=()=>({from:db.from.bind(db),auth:db.auth,rpc:async(name:string,args?:Record<string,unknown>)=>{
  const result=await db.rpc(name,args);
  if(name==='list_scheduled_digest_recipients'&&Array.isArray(result.data))return {...result,data:result.data.filter((row:{user_id:string})=>row.user_id===selected)};
  return result;
 }});
 globalThis.fetch=(async(input:string|URL|Request,init?:RequestInit)=>{
  const target=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);
  if(target.origin!==localApi.origin)throw new Error('External network refused');
  return originalFetch(input,init);
 }) as typeof fetch;
});
afterAll(()=>{globalThis.fetch=originalFetch;delete process.env.CRON_SECRET;});
test('same-week cutover holds a synthetic digest without queuing or sending',async()=>{
 const suffix=randomUUID();const email=`digest-${suffix}@example.invalid`;
 const auth=await db.auth.admin.createUser({email,password:`Local-${randomUUID()}Aa9!`,email_confirm:true});if(auth.error||!auth.data.user)throw new Error('Synthetic account creation failed');selected=auth.data.user.id;
 const profile=await db.from('profiles').select('email_unsubscribed').eq('id',selected).single();expect(profile.error).toBeNull();expect(profile.data?.email_unsubscribed).toBe(false);
 const facility=await db.from('facility_profiles').insert({name:'Synthetic digest facility',slug:`synthetic-digest-${suffix}`,business_type:'ヘアサロン',prefecture:'東京都',city:'テスト市',address:'テスト住所',status:'published'}).select('id').single();if(facility.error||!facility.data)throw new Error('Synthetic facility creation failed');
 const favorite=await db.from('favorites').insert({user_id:selected,facility_id:facility.data.id});if(favorite.error)throw new Error('Synthetic favorite creation failed');
 const coupon=await db.from('coupons').insert({facility_id:facility.data.id,name:'Synthetic coupon',is_active:true});if(coupon.error)throw new Error(`Synthetic coupon creation failed: ${coupon.error.code}`);
 const content=await db.rpc('scheduled_digest_content',{p_user_id:selected,p_since:new Date(Date.now()-7*86400000).toISOString()});expect(content.error).toBeNull();expect(Array.isArray(content.data)).toBe(true);expect(content.data).toHaveLength(1);
 const reserved=await db.rpc('reserve_scheduled_email_atomic',{p_kind:'favorites_digest',p_source_id:selected,p_email:email});expect(reserved.error).toBeNull();expect(reserved.data).toEqual([expect.objectContaining({state:'legacy_uncertain',operation_id:null})]);
 const result=await GET(new Request('http://127.0.0.1/api/cron/favorites-digest',{headers:{authorization:'Bearer synthetic-local-cron-only'}}));expect(result.status).toBe(200);expect(await result.json()).toMatchObject({queued:0,sent:0});
 const operations=await db.from('scheduled_email_operations').select('id').eq('kind','favorites_digest').eq('source_id',selected);expect(operations.error).toBeNull();expect(operations.data).toHaveLength(0);
});
