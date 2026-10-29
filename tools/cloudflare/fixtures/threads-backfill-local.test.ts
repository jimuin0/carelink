/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
let mockClient: () => unknown;
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => mockClient() }));
jest.mock('@/lib/alert', () => ({ alertDeliveryFailures: jest.fn(), alertWarning: jest.fn(), alertCaughtError: jest.fn() }));
import { GET } from '@/app/api/cron/threads-backfill/route';

// Never write to a merely local-looking database. Confirm the dedicated stack's
// owner, running identity and loopback API before creating any synthetic article.
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
const originalFetch = globalThis.fetch;
let selected: string[] = [];
let phase: 'success' | 'uncertain' | 'reconcile' | 'not-published' | 'container-429';
let calls: string[];
const mockResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status,headers:{'content-type':'application/json'}});
beforeAll(() => {
 process.env.THREADS_USER_ID = '123456'; process.env.CRON_SECRET = 'synthetic-local-cron-only';
 mockClient = () => ({
  rpc: db.rpc.bind(db),
  from: (table: string) => {
   if (table === 'threads_credentials') return { select: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { id: 'synthetic', access_token: 'synthetic-token', expires_at: '2099-01-01T00:00:00Z' }, error: null }) }) }) }) };
   if (table === 'platform_blog_posts') return { select: (...args: Parameters<ReturnType<typeof db.from>['select']>) => db.from('platform_blog_posts').select(...args).in('id', selected) };
   return db.from(table as 'cron_logs');
  },
 });
 globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const target = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  if (target.origin === localApi.origin && target.protocol === 'http:') return originalFetch(input, init);
  if (target.hostname !== 'graph.threads.net' || target.protocol !== 'https:' || target.searchParams.get('access_token') !== 'synthetic-token') throw new Error('External network refused');
  const method = init?.method ?? 'GET'; calls.push(`${method} ${target.pathname}`);
  if (method === 'POST' && target.pathname === '/v1.0/123456/threads') return phase === 'container-429' ? mockResponse({}, 429) : mockResponse({ id: '111111' });
  if (method === 'POST' && target.pathname === '/v1.0/123456/threads_publish') return phase === 'uncertain' ? mockResponse({}, 503) : mockResponse({ id: '222222' });
  if (method === 'GET' && target.pathname === '/v1.0/111111' && (phase === 'reconcile' || phase === 'not-published')) return mockResponse({id:'111111',status:phase === 'reconcile' ? 'PUBLISHED' : 'FINISHED'});
  throw new Error('Unexpected synthetic provider call');
 }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = originalFetch; delete process.env.THREADS_USER_ID; delete process.env.CRON_SECRET; });
async function insertSynthetic() {
 const id=randomUUID(); const result=await db.from('platform_blog_posts').insert({id,slug:`synthetic-threads-${id}`,title:'Synthetic Threads test',is_published:true}).select('id,title,slug').single();
 if(result.error || !result.data) throw new Error('Synthetic fixture insertion failed'); selected=[id]; return result.data;
}
const cron = () => GET(new Request('http://127.0.0.1/api/cron/threads-backfill',{headers:{authorization:'Bearer synthetic-local-cron-only'}}));
async function record(id:string) { const x=await db.from('platform_blog_posts').select('threads_post_id,threads_post_status,threads_creation_id,threads_delivery_started_at,threads_delivery_attempt_id').eq('id',id).single(); if(x.error||!x.data)throw new Error('Synthetic fixture read failed');return x.data; }
test('real cron and DB mark one synthetic article published once', async () => {
 phase='success';calls=[];const post=await insertSynthetic();const res=await cron();expect(res.status).toBe(200);expect(await res.json()).toMatchObject({processed:1,reconciled:0});
 expect(await record(post.id)).toMatchObject({threads_post_status:'published',threads_post_id:'222222',threads_creation_id:'111111'});
 expect(calls).toEqual(['POST /v1.0/123456/threads','POST /v1.0/123456/threads_publish']);
 const repeat=await cron();expect(repeat.status).toBe(200);expect((await repeat.json()).processed).toBe(0);expect(calls).toHaveLength(2);
});
test('uncertain publication is held, then read-only reconciliation never reposts', async () => {
 phase='uncertain';calls=[];const post=await insertSynthetic();const first=await cron();expect(first.status).toBe(500);const row=await record(post.id);
 expect(row).toMatchObject({threads_post_status:'ambiguous',threads_post_id:null,threads_creation_id:'111111'});expect(row.threads_delivery_started_at).toBeTruthy();expect(row.threads_delivery_attempt_id).toBeTruthy();
 phase='not-published';const held=await cron();expect(held.status).toBe(500);expect(await record(post.id)).toMatchObject({threads_post_status:'ambiguous',threads_post_id:null});
 phase='reconcile';const second=await cron();expect(second.status).toBe(200);expect(await second.json()).toMatchObject({processed:0,reconciled:1});expect(await record(post.id)).toMatchObject({threads_post_status:'published',threads_post_id:null,threads_creation_id:'111111'});
 expect(calls).toEqual(['POST /v1.0/123456/threads','POST /v1.0/123456/threads_publish','GET /v1.0/111111','GET /v1.0/111111']);
 const third=await cron();expect(third.status).toBe(200);expect((await third.json()).processed).toBe(0);expect(calls).toHaveLength(4);
});

test('prepublication rate limit releases only the synthetic claim and allows an explicit retry', async () => {
 phase='container-429';calls=[];const post=await insertSynthetic();const first=await cron();expect(first.status).toBe(500);expect(await record(post.id)).toMatchObject({threads_post_status:null,threads_post_id:null,threads_creation_id:null,threads_delivery_started_at:null});expect(calls).toEqual(['POST /v1.0/123456/threads']);
 phase='success';const retry=await cron();expect(retry.status).toBe(200);expect(await record(post.id)).toMatchObject({threads_post_status:'published',threads_post_id:'222222'});expect(calls).toEqual(['POST /v1.0/123456/threads','POST /v1.0/123456/threads','POST /v1.0/123456/threads_publish']);
});
test('concurrent cron requests cannot publish the same synthetic article twice', async () => {
 phase='success';calls=[];const post=await insertSynthetic();const results=await Promise.all([cron(),cron()]);expect(results.every(r=>r.status===200)).toBe(true);expect(await record(post.id)).toMatchObject({threads_post_status:'published',threads_post_id:'222222'});expect(calls.filter(x=>x==='POST /v1.0/123456/threads_publish')).toHaveLength(1);
});
