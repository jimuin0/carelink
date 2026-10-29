/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { prepareSalonIntent } from '@/lib/salon-submission-intent';
import { commitSalonSubmission } from '@/lib/salon-submission-commit';
const statusFile = process.env.CARELINK_LOCAL_CRON_STACK_STATUS;
if (!statusFile) throw new Error('Dedicated stack status required');
const saved = JSON.parse(readFileSync(statusFile, 'utf8'));
const root = realpathSync(saved.identity.project_root);
if (root !== '/private/tmp/carelink-cf-cron-check-20261029' || saved.runtime !== 'native') throw new Error('Unexpected stack');
const stack = JSON.parse(execFileSync('npm', ['exec', '--yes', '--package=supabase@2.122.0', '--', 'supabase', 'stack', 'status', '--output-format', 'json'], {
 cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, SUPABASE_EXPERIMENTAL_STACK: '1' }, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
}));
const api = new URL(stack.env.API_URL);
if (stack.identity.id !== saved.identity.id || stack.runtime !== 'native' || !['ready', 'sleeping'].includes(stack.readiness) || stack.env.API_URL !== saved.env.API_URL || api.protocol !== 'http:' || api.hostname !== '127.0.0.1' || !stack.env.SERVICE_ROLE_KEY || process.env.RESEND_API_KEY || process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK) throw new Error('Isolation guard failed');
const { createClient } = jest.requireActual('@supabase/supabase-js');
const db = createClient(api.origin, stack.env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(api.origin, stack.env.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const originalFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => { const u = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url); if (u.origin !== api.origin) throw new Error('External network refused'); return originalFetch(input, init); }) as typeof fetch; });
afterAll(() => { globalThis.fetch = originalFetch; });
test('synthetic classification is atomic, restricted to current admins, and leaves registration data intact', async () => {
 const suffix = randomUUID();
 const prepared = await prepareSalonIntent(db); if (prepared.state !== 'prepared') throw new Error('Synthetic intent failed');
 const result = await commitSalonSubmission(db, { intentId: prepared.intentId, registration: { facility_name: 'Synthetic classification', business_type: 'ヘアサロン', representative_name: 'Synthetic', contact_name: 'Synthetic', email: `classification-${suffix}@example.invalid`, phone: '09000000000', source: 'register' }, photoIds: [], consent: { terms_agreed: true, license_warranted: true } }, prepared.proof);
 if (result.state !== 'committed') throw new Error('Synthetic registration failed');
 const user = await db.auth.admin.createUser({ email: `classification-admin-${suffix}@example.invalid`, password: `Local-${randomUUID()}Aa9!`, email_confirm: true });
 if (user.error || !user.data.user) throw new Error('Synthetic admin failed');
 const actor = user.data.user.id, salon = result.receiptId;
 const promoted = await db.from('profiles').update({ is_platform_admin: true }).eq('id', actor).select('id').single(); if (promoted.error) throw new Error('Synthetic admin setup failed');
 const args = { p_actor: actor, p_salon: salon, p_value: 'test', p_expected_revision: 0 };
 const before = await db.from('salons').select('id,status,claimed_facility_id').eq('id', salon).single(); expect(before.error).toBeNull();
 const denied = await anon.rpc('set_salon_registration_classification', args); expect(denied.error).not.toBeNull();
 const races = await Promise.all([db.rpc('set_salon_registration_classification', args), db.rpc('set_salon_registration_classification', args)]);
 expect(races.map((r: { data: { outcome: string } }) => r.data.outcome).sort()).toEqual(['conflict', 'updated']);
 const label = await db.from('salon_registration_classifications').select('classification,revision').eq('salon_id', salon).single(); expect(label.data).toEqual({ classification: 'test', revision: 1 });
 const revoked = await db.from('profiles').update({ is_platform_admin: false }).eq('id', actor); if (revoked.error) throw new Error('Synthetic admin revoke failed');
 const afterRevocation = await db.rpc('set_salon_registration_classification', { ...args, p_value: 'real', p_expected_revision: 1 }); expect(afterRevocation.data.outcome).toBe('forbidden');
 const after = await db.from('salons').select('id,status,claimed_facility_id').eq('id', salon).single(); expect(after.data).toEqual(before.data);
});
