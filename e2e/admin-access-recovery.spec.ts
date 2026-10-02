import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

// Dedicated synthetic actors, managed disposable local Auth/Postgres only.
// No hosted Auth failures, production data, delivery keys or persistent traces.
test.beforeAll(() => {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true'
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://localhost:54330'
    || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000'
    || !process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.RESEND_API_KEY
    || process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK) {
    throw new Error('Admin access recovery requires managed isolated CI without sending credentials');
  }
});
test.use({ serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' });
function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } });
}
async function identity(client: ReturnType<typeof db>) {
  const email = `synthetic-access-${randomUUID()}@example.invalid`, password = randomUUID();
  const created = await client.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error('Disposable identity creation failed');
  return { id: created.data.user.id, email, password };
}
async function login(page: Page, actor: Awaited<ReturnType<typeof identity>>) {
  await page.goto('/auth/login?redirect=%2Fregister%2Frecover');
  await page.getByRole('button', { name: '必須のみ', exact: true }).click();
  await expect(page.getByRole('button', { name: '必須のみ', exact: true })).toBeHidden();
  await page.fill('#login-email', actor.email); await page.fill('#login-password', actor.password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/register/recover');
}

test('layout permission observation failure -> same-query document GET retry -> no mutation replay', async ({ page }) => {
  const client = db(), actor = await identity(client);
  await login(page, actor);
  const original = await client.from('profiles').select('*').eq('id', actor.id).single();
  if (original.error || !original.data) throw new Error('Disposable own profile snapshot failed');
  // Both derived columns are GENERATED ALWAYS (verified against the replayed
  // catalog). Restore their inputs; never insert select('*') generated values.
  const restoreRow = { ...original.data };
  delete restoreRow.birth_md;
  delete restoreRow.email_canonical;
  // Only this new actor's synthetic profile is removed, not the identity or any
  // business record. Restore its exact row in finally; no shared policy changes.
  const removed = await client.from('profiles').delete().eq('id', actor.id).select('id');
  if (removed.error || removed.data?.length !== 1) throw new Error('Disposable own profile fault setup failed');
  try {
    let mutations = 0;
    page.on('request', request => {
      if (request.method() !== 'GET' && /\/api\/(admin\/|facility\/setup)/.test(new URL(request.url()).pathname)) mutations++;
    });
    const current = '/admin/onboarding?access_retry=synthetic-proof';
    await page.goto(current);
    const retry = page.getByRole('button', { name: '利用権限を再確認', exact: true });
    await expect(retry).toBeVisible();
    await expect(page.getByText('直前の操作結果は別途確認してください。', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: '施設情報を確認', exact: true })).toBeHidden();
    const restored = await client.from('profiles').insert(restoreRow).select('id');
    if (restored.error || restored.data?.length !== 1) throw new Error('Disposable own profile restoration failed');
    const document = page.waitForRequest(request => request.isNavigationRequest()
      && request.frame() === page.mainFrame() && new URL(request.url()).pathname === '/admin/onboarding');
    await retry.click();
    const request = await document;
    expect(request.method()).toBe('GET'); expect(new URL(request.url()).search).toBe('?access_retry=synthetic-proof');
    await expect(retry).toBeHidden();
    await expect(page.getByRole('heading', { name: '施設情報を確認', exact: true })).toBeVisible();
    expect(mutations).toBe(0);
    const members = await client.from('facility_members').select('facility_id').eq('user_id', actor.id);
    expect(members.error).toBeNull(); expect(members.data).toEqual([]);
  } finally {
    const observed = await client.from('profiles').select('*').eq('id', actor.id).maybeSingle();
    if (observed.error) throw new Error('Disposable own profile cleanup observation failed');
    if (!observed.data) {
      const restored = await client.from('profiles').insert(restoreRow).select('id');
      if (restored.error || restored.data?.length !== 1) throw new Error('Disposable own profile cleanup failed');
    } else {
      expect(observed.data).toEqual(original.data);
    }
  }
});

test('browser Auth read fails -> explicit settings retry -> same tenant, no automatic save', async ({ page }) => {
  const client = db(), actor = await identity(client), facility = randomUUID();
  const name = `合成権限再確認 ${randomUUID()}`;
  const created = await client.from('facility_profiles').insert({ id: facility, slug: `synthetic-access-${facility}`,
    name, business_type: 'ヘアサロン', prefecture: '愛知県', city: '合成市', address: '合成町1', status: 'draft' });
  if (created.error) throw new Error('Disposable facility setup failed');
  const membership = await client.from('facility_members').insert({ user_id: actor.id, facility_id: facility, role: 'owner' });
  if (membership.error) throw new Error('Disposable membership setup failed');
  await login(page, actor);
  let saves = 0;
  page.on('request', request => { if (request.method() === 'PATCH' && new URL(request.url()).pathname === '/api/admin/settings') saves++; });
  // Browser-only /auth/v1/user response fault. SSR Auth remains the real local
  // service. SDK classification is also tested separately with transport stubs.
  await page.route('**/auth/v1/user', route => route.fulfill({ status: 503, contentType: 'application/json',
    headers: { 'x-supabase-api-version': '2024-01-01' }, body: JSON.stringify({ code: 'unexpected_failure', message: 'synthetic unavailable' }) }));
  await page.goto(`/admin/settings?facility_id=${facility}`);
  await expect(page.getByRole('button', { name: '再試行', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存する', exact: true })).toBeHidden();
  expect(new URL(page.url()).searchParams.get('facility_id')).toBe(facility);
  await page.unroute('**/auth/v1/user');
  await page.getByRole('button', { name: '再試行', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /施設名/ })).toHaveValue(name);
  expect(new URL(page.url()).searchParams.get('facility_id')).toBe(facility); expect(saves).toBe(0);
  const stored = await client.from('facility_profiles').select('name,status').eq('id', facility).single();
  expect(stored.error).toBeNull(); expect(stored.data).toEqual({ name, status: 'draft' });
});
