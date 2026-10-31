import { isolatedStack } from './assert-local-stack.mjs';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const env = isolatedStack();
const api = new URL(env.API_URL);
assert.ok(['127.0.0.1', 'localhost'].includes(api.hostname));
const app = 'http://127.0.0.1:18744';
const admin = createClient(api.href, env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = randomUUID().slice(0, 8);
const email = `cf-audit-${suffix}@example.invalid`;
const password = randomBytes(24).toString('hex');
const account = await admin.auth.admin.createUser({ email, password, email_confirm: true });
assert.ifError(account.error);
const facility = await admin.from('facility_profiles').insert({ name: '監査検証の合成施設', slug: `cf-audit-${suffix}`,
  business_type: 'ヘアサロン', prefecture: '東京都', city: 'テスト市', address: 'テスト住所', status: 'draft' }).select('id').single();
assert.ifError(facility.error);
const member = await admin.from('facility_members').insert({ facility_id: facility.data.id, user_id: account.data.user.id, role: 'owner' });
assert.ifError(member.error);
const jar = new Map();
const auth = createServerClient(api.href, env.ANON_KEY, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  setAll: values => { for (const { name, value } of values) jar.set(name, value); } } });
assert.ifError((await auth.auth.signInWithPassword({ email, password })).error);
const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
const response = await fetch(`${app}/api/admin/staff?facility_id=${facility.data.id}`, { method: 'POST',
  headers: { origin: app, cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ operation_id: randomUUID(), name: '監査検証の合成スタッフ' }) });
assert.equal(response.status, 201, 'synthetic staff create failed');
const result = await response.json();
assert.ok(result.staff?.id);
let entries;
for (let attempt = 0; attempt < 30; attempt++) {
  const query = await admin.from('audit_logs').select('id,user_id,facility_id,action,table_name,record_id')
    .eq('facility_id', facility.data.id).eq('record_id', result.staff.id).eq('table_name', 'staff_profiles').eq('action', 'create');
  assert.ifError(query.error);
  entries = query.data;
  if (entries.length) break;
  await new Promise(resolve => setTimeout(resolve, 100));
}
assert.equal(entries.length, 1, 'expected exactly one application audit record');
assert.equal(entries[0].user_id, account.data.user.id);
console.log('Synthetic staff create: 201; after-response audit persisted once with correct actor and facility');
const revoked = await admin.from('facility_members').delete().eq('facility_id', facility.data.id).eq('user_id', account.data.user.id);
assert.ifError(revoked.error);
const denied = await fetch(`${app}/api/admin/staff?facility_id=${facility.data.id}`, { method: 'POST',
  headers: { origin: app, cookie, 'content-type': 'application/json' },
  body: JSON.stringify({ operation_id: randomUUID(), name: '拒否される合成スタッフ' }) });
assert.equal(denied.status, 401, 'revoked member was not denied');
const staff = await admin.from('staff_profiles').select('id', { count: 'exact', head: true }).eq('facility_id', facility.data.id);
assert.ifError(staff.error);
assert.equal(staff.count, 1, 'unexpected staff write after revocation');
console.log('Revoked membership: existing session denied; no additional staff created');
