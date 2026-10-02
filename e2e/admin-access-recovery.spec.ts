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

test('verified customer GET renders mypage navigation; anonymous GET still requires login', async ({ page }) => {
  const client = db(), actor = await identity(client);
  await page.goto('/mypage?access_retry=synthetic-proof');
  await page.waitForURL(url => url.pathname === '/auth/login');
  await login(page, actor);
  const response = await page.goto('/mypage?access_retry=synthetic-proof');
  expect(response?.status()).toBe(200);
  await expect(page.locator('nav').getByRole('link', { name: 'ダッシュボード', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: /さん、こんにちは/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '利用権限を再確認', exact: true })).toBeHidden();
  expect(new URL(page.url()).search).toBe('?access_retry=synthetic-proof');
});

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

test('two-store operator keeps explicit store through dashboard, today bookings and staff editing; failed read cannot save', async ({ page }) => {
  test.setTimeout(90000);
  const client = db(), actor = await identity(client);
  const first = randomUUID(), second = randomUUID(), staffA = randomUUID(), staffB = randomUUID();
  const suffix = randomUUID();
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
  const tomorrow = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date(Date.now() + 86400000));
  const names = { a: `合成店舗A ${suffix}`, b: `合成店舗B ${suffix}`, today: `合成本日B ${suffix}`, other: `合成翌日B ${suffix}`, wrong: `合成本日A ${suffix}` };
  const facilities = await client.from('facility_profiles').insert([
    { id: first, slug: `synthetic-a-${first}`, name: names.a, business_type: 'ヘアサロン', prefecture: '愛知県', city: '合成市', address: '合成町A', status: 'draft' },
    { id: second, slug: `synthetic-b-${second}`, name: names.b, business_type: 'ヘアサロン', prefecture: '愛知県', city: '合成市', address: '合成町B', status: 'draft' },
  ]);
  if (facilities.error) throw new Error(`Disposable facilities setup failed (${facilities.error.code})`);
  const memberships = await client.from('facility_members').insert([
    // One self-registered owner store is enforced by the schema. A second
    // existing store grants admin membership; this does not expand owner signup.
    { user_id: actor.id, facility_id: first, role: 'owner' }, { user_id: actor.id, facility_id: second, role: 'admin' },
  ]);
  if (memberships.error) throw new Error(`Disposable memberships setup failed (${memberships.error.code})`);
  const staff = await client.from('staff_profiles').insert([
    { id: staffA, facility_id: first, name: `スタッフA ${suffix}`, slug: `synthetic-${staffA}`, is_active: true },
    { id: staffB, facility_id: second, name: `スタッフB ${suffix}`, slug: `synthetic-${staffB}`, is_active: true },
  ]);
  if (staff.error) throw new Error(`Disposable staff setup failed (${staff.error.code})`);
  const bookings = await client.from('bookings').insert([
    { facility_id: first, staff_id: staffA, booking_date: today, start_time: '10:00', end_time: '11:00', customer_name: names.wrong, email: actor.email, status: 'confirmed' },
    { facility_id: second, staff_id: staffB, booking_date: today, start_time: '10:00', end_time: '11:00', customer_name: names.today, email: actor.email, status: 'confirmed' },
    { facility_id: second, staff_id: staffB, booking_date: tomorrow, start_time: '10:00', end_time: '11:00', customer_name: names.other, email: actor.email, status: 'confirmed' },
  ]);
  if (bookings.error) throw new Error(`Disposable bookings setup failed (${bookings.error.code})`);
  await login(page, actor);
  for (const path of ['/admin', '/admin/menus', '/admin/staff', '/admin/analytics']) {
    await page.goto(`${path}?facility_id=${second}`);
    await expect(page.getByRole('region', { name: '編集する店舗' }).getByRole('link', { name: `${names.b}（選択中）`, exact: true })).toHaveAttribute('aria-current', 'page');
    expect(new URL(page.url()).searchParams.get('facility_id')).toBe(second);
  }
  await page.goto(`/admin?facility_id=${second}`);
  const todayLink = page.getByRole('link', { name: /本日の予約一覧/ });
  const href = new URL((await todayLink.getAttribute('href'))!, 'https://localhost:3000');
  expect(Object.fromEntries(href.searchParams)).toEqual({ from: today, to: today, facility_id: second });
  await todayLink.click();
  await expect(page.getByText(names.today, { exact: true })).toBeVisible();
  await expect(page.getByText(names.other, { exact: true })).toBeHidden();
  await expect(page.getByText(names.wrong, { exact: true })).toBeHidden();
  await page.goto(`/admin/staff?facility_id=${second}`);
  await page.getByRole('link', { name: '編集', exact: true }).click();
  await expect(page.locator('#staff-name')).toHaveValue(`スタッフB ${suffix}`);
  expect(new URL(page.url()).searchParams.get('facility_id')).toBe(second);
  let mutations = 0;
  page.on('request', request => { if (request.method() === 'PATCH' && new URL(request.url()).pathname === `/api/admin/staff/${staffB}`) mutations++; });
  const edited = `変更B ${suffix}`;
  await page.locator('#staff-name').fill(edited);
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/staff/${staffB}` && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/staff\\?facility_id=${second}$`));
  await expect(page.getByText(edited, { exact: true })).toBeVisible();
  const stored = await client.from('staff_profiles').select('id,name,facility_id').in('id', [staffA, staffB]);
  expect(stored.error).toBeNull();
  expect(stored.data).toEqual(expect.arrayContaining([
    { id: staffA, name: `スタッフA ${suffix}`, facility_id: first }, { id: staffB, name: edited, facility_id: second },
  ]));
  await page.route('**/rest/v1/staff_profiles?**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'synthetic unavailable' }) }));
  await page.goto(`/admin/staff/${staffB}/edit?facility_id=${second}`);
  await expect(page.getByText('スタッフ情報の読み込みに失敗しました', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeHidden();
  expect(new URL(page.url()).searchParams.get('facility_id')).toBe(second);
  expect(mutations).toBe(1);
  await page.unroute('**/rest/v1/staff_profiles?**');
  await page.getByRole('button', { name: '再試行', exact: true }).click();
  await expect(page.locator('#staff-name')).toHaveValue(edited);
  expect(mutations).toBe(1);
});
