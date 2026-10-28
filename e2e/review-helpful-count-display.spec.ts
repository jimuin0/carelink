import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

// Synthetic data only, inside the disposable CI DB. Production has no public review
// yet, so this is where the helpful count is seen end to end: DB -> RPC -> page.
test.beforeAll(() => {
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://localhost:54330'
    || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000'
    || !process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.RESEND_API_KEY) {
    throw new Error('Helpful-count display requires isolated CI without send credentials');
  }
});
test.use({ serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' });

test('an anonymous visitor sees the helpful count of a public review, without voter IDs', async ({ page }) => {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const voters: string[] = [];
  const id = randomUUID(); const slug = `helpful-${id}`;
  const shown = randomUUID(); const hidden = randomUUID();
  try {
    for (let i = 0; i < 2; i++) {
      const voter = await db.auth.admin.createUser({ email: `helpful-voter-${randomUUID()}@example.invalid`,
        password: randomUUID(), email_confirm: true });
      expect(voter.error).toBeNull(); voters.push(voter.data.user!.id);
    }
    expect((await db.from('facility_profiles').insert({ id, name: '合成口コミ件数検証', slug, business_type: 'その他',
      prefecture: '東京都', city: '検証市', address: '合成町1', status: 'published' })).error).toBeNull();
    expect((await db.from('facility_reviews').insert([
      { id: shown, facility_id: id, reviewer_name: '合成投稿者', reviewer_ip: '127.0.0.21', rating: 5,
        comment: '合成の公開口コミです', status: 'published', is_flagged: false },
      { id: hidden, facility_id: id, reviewer_name: '合成非公開', reviewer_ip: '127.0.0.22', rating: 3,
        comment: '合成の非公開口コミです', status: 'hidden', is_flagged: false },
    ])).error).toBeNull();
    expect((await db.from('review_helpful').insert([
      { review_id: shown, user_id: voters[0] }, { review_id: shown, user_id: voters[1] },
      { review_id: hidden, user_id: voters[0] },
    ])).error).toBeNull();

    const counts = page.waitForResponse(response => response.url().includes('/rest/v1/rpc/get_review_helpful_counts'));
    await page.goto(`/facility/${slug}#review`);
    const rpc = await counts;
    expect(rpc.status()).toBe(200);
    const body = await rpc.json() as Array<Record<string, unknown>>;
    expect(body).toEqual([{ review_id: shown, helpful_count: 2 }]);
    expect(JSON.stringify(body)).not.toContain(voters[0]);

    await expect(page.getByText('合成の公開口コミです', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '役に立った (2)', exact: true })).toBeVisible();
    await expect(page.getByText('合成の非公開口コミです', { exact: true })).toHaveCount(0);
  } finally {
    expect((await db.from('facility_profiles').delete().eq('id', id)).error).toBeNull();
    for (const voter of voters) expect((await db.auth.admin.deleteUser(voter)).error).toBeNull();
  }
});
