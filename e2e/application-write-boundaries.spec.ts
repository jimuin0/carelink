import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

test('simultaneous general applications save one isolated candidate record', async ({ request, baseURL }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const local = (value: string) => {
    const parsed = new URL(value);
    return ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) && !parsed.username && !parsed.password;
  };
  if (!url || !secret || !baseURL || !local(url) || !local(baseURL)) throw new Error('Isolated local application fixture required');
  const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const facilityId = randomUUID();
  try {
    const facility = await db.from('facility_profiles').insert({ id: facilityId, slug: `e2e-application-${facilityId}`,
      name: 'Isolated application fixture', business_type: 'ヘアサロン', prefecture: '東京都', city: 'テスト市', address: 'テスト1', status: 'draft' });
    expect(facility.error).toBeNull();
    const data = { facility_id: facilityId, applicant_name: 'Isolated candidate', applicant_email: `candidate-${facilityId}@example.invalid` };
    const responses = await Promise.all([1, 2].map(() => request.post('/api/admin/job-applications', { headers: { Origin: new URL(baseURL).origin }, data })));
    expect(responses.map(response => response.status()).sort()).toEqual([201, 409]);
    const accepted = responses.find(response => response.status() === 201)!;
    const receipt = await accepted.json();
    expect(receipt.application.facility_id).toBe(facilityId);
    expect(receipt.application.status).toBe('pending');
    const rows = await db.from('job_applications').select('id, facility_id, applicant_email, applicant_user_id, status')
      .eq('facility_id', facilityId).eq('applicant_email', data.applicant_email);
    expect(rows.error).toBeNull(); expect(rows.data).toHaveLength(1);
    expect(rows.data![0]).toMatchObject({ id: receipt.application.id, facility_id: facilityId, applicant_email: data.applicant_email, applicant_user_id: null, status: 'pending' });
  } finally {
    expect((await db.from('job_applications').delete().eq('facility_id', facilityId)).error).toBeNull();
    expect((await db.from('facility_profiles').delete().eq('id', facilityId)).error).toBeNull();
  }
});
