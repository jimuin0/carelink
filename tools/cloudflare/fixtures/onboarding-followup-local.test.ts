/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
let mockClient: () => unknown;
jest.mock('@supabase/supabase-js', () => ({ ...jest.requireActual('@supabase/supabase-js'), createClient: () => mockClient() }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => mockClient() }));
jest.mock('@/lib/email', () => ({ sendOnboardingFollowEmail: jest.fn(), sendRegistrationLeadFollowEmail: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertDeliveryFailures: jest.fn(), alertWarning: jest.fn(), alertCaughtError: jest.fn() }));
import { sendOnboardingFollowEmail, sendRegistrationLeadFollowEmail } from '@/lib/email';
let mockFailMark = false;
jest.mock('@/lib/cron-delivery-state', () => { const actual = jest.requireActual('@/lib/cron-delivery-state'); return { ...actual, markFollowupDelivery: (...args: unknown[]) => mockFailMark ? Promise.resolve(false) : actual.markFollowupDelivery(...args) }; });
import { GET } from '@/app/api/cron/onboarding-followup/route';
import { prepareSalonIntent } from '@/lib/salon-submission-intent';
import { commitSalonSubmission } from '@/lib/salon-submission-commit';
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
const db = jest.requireActual('@supabase/supabase-js').createClient(stack.env.API_URL, stack.env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const originalFetch = globalThis.fetch;
let selected: string[] = [];
let selectedFacility = '00000000-0000-0000-0000-000000000000';
beforeAll(() => {
 process.env.CRON_SECRET = 'synthetic-local-cron-only';
 mockClient = () => ({ from: (table: string) => {
  const original = db.from(table);
  if (table === 'facility_profiles') return { select: (...args: unknown[]) => original.select(...args).eq('id', selectedFacility), update: (...args: unknown[]) => original.update(...args) };
  if (table === 'salons') return { select: (...args: unknown[]) => original.select(...args).in('id', selected), update: (...args: unknown[]) => original.update(...args) };
  return original;
 }});
 globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const target = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  if (target.origin !== localApi.origin) throw new Error('External network refused');
  return originalFetch(input, init);
 }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = originalFetch; delete process.env.CRON_SECRET; });
beforeEach(() => { mockFailMark=false; selectedFacility='00000000-0000-0000-0000-000000000000'; jest.clearAllMocks(); (sendRegistrationLeadFollowEmail as jest.Mock).mockResolvedValue(true); });
async function insertSynthetic(status = 'pending') {
 const suffix=randomUUID(); const email=`followup-${suffix}@example.invalid`;
 const prepared=await prepareSalonIntent(db); if(prepared.state!=='prepared') throw new Error('Synthetic intent preparation failed');
 const result=await commitSalonSubmission(db,{intentId:prepared.intentId,registration:{facility_name:'Synthetic followup',business_type:'ヘアサロン',representative_name:'Synthetic',contact_name:'Synthetic',email,phone:'09000000000',source:'register'},photoIds:[],consent:{terms_agreed:true,license_warranted:true}},prepared.proof);
 if(result.state!=='committed') throw new Error(`Synthetic registration failed: ${result.state}`);
 const id=result.receiptId; const adjusted=await db.from('salons').update({status,created_at:new Date(Date.now()-4*24*60*60*1000).toISOString()}).eq('id',id).select('id').single();
 if(adjusted.error || !adjusted.data) throw new Error('Synthetic age adjustment failed'); selected=[id]; return {id,email};
}
const cron=()=>GET(new Request('http://127.0.0.1/api/cron/onboarding-followup',{headers:{authorization:'Bearer synthetic-local-cron-only'}}));
async function sentAt(id:string) { const x=await db.from('salons').select('registration_followup_sent_at').eq('id',id).single();if(x.error||!x.data)throw new Error('Synthetic fixture read failed');return x.data.registration_followup_sent_at; }
test('an unclaimed synthetic lead is marked once after simulated delivery', async () => {
 const lead=await insertSynthetic();const result=await cron();expect(result.status).toBe(200);expect(await result.json()).toMatchObject({sent:1});expect(await sentAt(lead.id)).toBeTruthy();expect(sendRegistrationLeadFollowEmail).toHaveBeenCalledWith(expect.objectContaining({email:lead.email,receiptId:lead.id}));
 const repeat=await cron();expect(repeat.status).toBe(200);expect(sendRegistrationLeadFollowEmail).toHaveBeenCalledTimes(1);expect(sendOnboardingFollowEmail).not.toHaveBeenCalled();
});
test('a simulated pre-delivery failure releases the claim for a subsequent retry', async () => {
 const lead=await insertSynthetic();(sendRegistrationLeadFollowEmail as jest.Mock).mockImplementationOnce(async data=>{data.onOutcome('rejected');return false;});const first=await cron();expect(first.status).toBe(500);expect(await sentAt(lead.id)).toBeNull();
 const retry=await cron();expect(retry.status).toBe(200);expect(await sentAt(lead.id)).toBeTruthy();expect(sendRegistrationLeadFollowEmail).toHaveBeenCalledTimes(2);
});
test('a rejected synthetic application never triggers the simulated email', async () => {
 const lead=await insertSynthetic('rejected');const result=await cron();expect(result.status).toBe(200);expect(await sentAt(lead.id)).toBeNull();expect(sendRegistrationLeadFollowEmail).not.toHaveBeenCalled();
});
test('concurrent cron requests simulate at most one email for the same lead', async () => {
 const lead=await insertSynthetic();const results=await Promise.all([cron(),cron()]);expect(results.every(r=>r.status===200)).toBe(true);expect(await sentAt(lead.id)).toBeTruthy();expect(sendRegistrationLeadFollowEmail).toHaveBeenCalledTimes(1);
});
test('a previously claimed synthetic application never triggers the simulated email', async () => {
 const lead=await insertSynthetic();const changed=await db.from('salons').update({claimed_at:new Date().toISOString()}).eq('id',lead.id).select('id').single();if(changed.error || !changed.data)throw new Error('Synthetic claim setup failed');
 const result=await cron();expect(result.status).toBe(200);expect(await sentAt(lead.id)).toBeNull();expect(sendRegistrationLeadFollowEmail).not.toHaveBeenCalled();
});

test('an uncertain simulated response keeps the claim and is never sent twice', async () => {
 const lead=await insertSynthetic();(sendRegistrationLeadFollowEmail as jest.Mock).mockImplementationOnce(async data=>{data.onOutcome('uncertain');return false;});
 const first=await cron();expect(first.status).toBe(500);expect(await sentAt(lead.id)).toBeTruthy();const repeat=await cron();expect(repeat.status).toBe(200);expect(sendRegistrationLeadFollowEmail).toHaveBeenCalledTimes(1);
 const aged=await db.from('salons').update({registration_followup_sent_at:new Date(Date.now()-20*60000).toISOString()}).eq('id',lead.id);if(aged.error)throw new Error('Synthetic claim age adjustment failed');
 const held=await cron();expect(held.status).toBe(500);expect(await held.json()).toMatchObject({pendingHolds:1});
 // Simulated operator reconciliation only for this synthetic provider result.
 const resolved=await db.from('salons').update({registration_followup_delivery_state:'delivered'}).eq('id',lead.id).eq('registration_followup_delivery_state','pending');if(resolved.error)throw new Error('Synthetic reconciliation failed');
 const after=await cron();expect(after.status).toBe(200);
});

test('a synthetic facility without an owner is durably skipped', async () => {
 selected=['00000000-0000-0000-0000-000000000000'];const id=randomUUID();selectedFacility=id;
 const created=await db.from('facility_profiles').insert({id,name:'Synthetic no-owner facility',slug:`synthetic-no-owner-${id}`,business_type:'ヘアサロン',prefecture:'東京都',city:'テスト市',address:'テスト住所',status:'draft',created_at:new Date(Date.now()-4*86400000).toISOString()});if(created.error)throw new Error('Synthetic facility creation failed');
 const result=await cron();expect(result.status).toBe(200);const saved=await db.from('facility_profiles').select('onboarding_email_delivery_state').eq('id',id).single();expect(saved.error).toBeNull();expect(saved.data).toMatchObject({onboarding_email_delivery_state:'skipped'});expect(sendOnboardingFollowEmail).not.toHaveBeenCalled();
});
test('a synthetic lead with an existing account is durably skipped', async () => {
 const lead=await insertSynthetic();const user=await db.auth.admin.createUser({email:lead.email,password:`Local-${randomUUID()}Aa9!`,email_confirm:true});if(user.error||!user.data.user)throw new Error('Synthetic account creation failed');
 const result=await cron();expect(result.status).toBe(200);const saved=await db.from('salons').select('registration_followup_delivery_state').eq('id',lead.id).single();expect(saved.error).toBeNull();expect(saved.data).toMatchObject({registration_followup_delivery_state:'skipped'});expect(sendRegistrationLeadFollowEmail).not.toHaveBeenCalled();
});

test('lost lead acceptance acknowledgement leaves a monitored pending claim',async()=>{
 const lead=await insertSynthetic();mockFailMark=true;
 const first=await cron();expect(first.status).toBe(500);expect(await first.json()).toMatchObject({deliveryUncertain:1});mockFailMark=false;
 const state=await db.from('salons').select('registration_followup_delivery_state').eq('id',lead.id).single();expect(state.error).toBeNull();expect(state.data).toMatchObject({registration_followup_delivery_state:'pending'});
 const aged=await db.from('salons').update({registration_followup_sent_at:new Date(Date.now()-20*60000).toISOString()}).eq('id',lead.id);if(aged.error)throw new Error('Synthetic claim age adjustment failed');
 const held=await cron();expect(held.status).toBe(500);expect(await held.json()).toMatchObject({pendingHolds:1});expect(sendRegistrationLeadFollowEmail).toHaveBeenCalledTimes(1);
 const resolved=await db.from('salons').update({registration_followup_delivery_state:'delivered'}).eq('id',lead.id).eq('registration_followup_delivery_state','pending');if(resolved.error)throw new Error('Synthetic reconciliation failed');
});
