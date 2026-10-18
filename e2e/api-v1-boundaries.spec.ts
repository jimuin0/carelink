import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

test('external API bounds invalid filters and keeps key authority inside its fixture facility', async ({ request, baseURL }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const local = (value: string) => {
    const parsed = new URL(value);
    return ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) && !parsed.username && !parsed.password;
  };
  if (!url || !secret || !baseURL || !local(url) || !local(baseURL)) throw new Error('Isolated local API fixture required');
  const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const facilityId = randomUUID();
  const keyId = randomUUID();
  const raw = `ck_live_${randomBytes(32).toString('hex')}`;
  const headers = { Authorization: `Bearer ${raw}` };
  try {
    const facility = await db.from('facility_profiles').insert({ id: facilityId, slug: `e2e-v1-${facilityId}`,
      name: 'Isolated API boundary fixture', business_type: 'ヘアサロン', prefecture: '東京都', city: 'テスト市', address: 'テスト1', status: 'draft' });
    expect(facility.error).toBeNull();
    const key = await db.from('api_keys').insert({ id: keyId, facility_id: facilityId, name: 'Isolated fixture key',
      key_hash: createHash('sha256').update(raw).digest('hex'), key_prefix: raw.slice(0, 16), scopes: ['bookings:read', 'customers:read'] });
    expect(key.error).toBeNull();
    for (const resource of ['bookings', 'customers']) {
      const response = await request.get(`/api/v1/${resource}?limit=-5`, { headers });
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.pagination.limit).toBe(1);
      expect(body.data).toEqual([]);
      const foreign = await request.get(`/api/v1/${resource}?facility_id=${randomUUID()}`, { headers });
      expect(foreign.status()).toBe(403);
    }
    for (const query of ['from=2026-02-30', 'to=0000-01-01', 'from=2026-10-19&to=2026-10-18']) {
      expect((await request.get(`/api/v1/bookings?${query}`, { headers })).status()).toBe(400);
    }
    const expired = await db.from('api_keys').update({ expires_at: '2000-01-01T00:00:00Z' }).eq('id', keyId).eq('facility_id', facilityId);
    expect(expired.error).toBeNull();
    for (const resource of ['bookings', 'customers']) expect((await request.get(`/api/v1/${resource}`, { headers })).status()).toBe(401);
    const revoked = await db.from('api_keys').update({ expires_at: null, is_active: false }).eq('id', keyId).eq('facility_id', facilityId);
    expect(revoked.error).toBeNull();
    for (const resource of ['bookings', 'customers']) expect((await request.get(`/api/v1/${resource}`, { headers })).status()).toBe(401);
  } finally {
    expect((await db.from('api_keys').delete().eq('id', keyId).eq('facility_id', facilityId)).error).toBeNull();
    expect((await db.from('facility_profiles').delete().eq('id', facilityId)).error).toBeNull();
  }
});
