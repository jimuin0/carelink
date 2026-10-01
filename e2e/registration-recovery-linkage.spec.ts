import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { observeFacilitySetup } from './facility-setup-observer';

// Real browser + Auth + application API + disposable Postgres. Never reuse a
// running developer server, hosted credentials, provider send keys or real data.
test.beforeAll(() => {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true'
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://localhost:54330'
    || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000'
    || process.env.SALON_REGISTRATION_V2_ENABLED !== 'true'
    || !process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.RESEND_API_KEY || process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK) {
    throw new Error('registration recovery requires the managed isolated CI lifecycle without sending credentials');
  }
});
test.use({ serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' });

function localDb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } });
}
async function identity(db: ReturnType<typeof localDb>, platform = false) {
  const email = `synthetic-recovery-${randomUUID()}@example.invalid`;
  const password = randomUUID();
  const result = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (result.error || !result.data.user) throw new Error('Disposable confirmed identity creation failed');
  if (platform) {
    const updated = await db.from('profiles').update({ is_platform_admin: true }).eq('id', result.data.user.id).select('id');
    if (updated.error || updated.data?.length !== 1) throw new Error('Disposable platform identity setup failed');
  }
  return { email, password, id: result.data.user.id };
}
async function receipt(db: ReturnType<typeof localDb>, email: string, name: string) {
  const id = randomUUID();
  const result = await db.from('salons').insert({ id, email, facility_name: name, business_type: 'ヘアサロン',
    phone: '09000000000', representative_name: '合成代表', contact_name: '合成担当', source: 'register',
    prefecture: '愛知県', city: '西尾市', address: '合成町1', building_name: '合成建物', is_public: false });
  if (result.error) throw new Error('Disposable application setup failed');
  return id;
}
async function login(page: Page, person: Awaited<ReturnType<typeof identity>>, redirect: string) {
  await page.goto(`/auth/login?redirect=${encodeURIComponent(redirect)}`);
  // Each identity logs in from a fresh context. Make the actual privacy choice
  // instead of force-clicking through the mobile Cookie banner or seeding consent.
  await page.getByRole('button', { name: '必須のみ', exact: true }).click();
  await expect(page.getByRole('button', { name: '必須のみ', exact: true })).toBeHidden();
  await page.fill('#login-email', person.email);
  await page.fill('#login-password', person.password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.waitForURL(url => url.pathname === redirect.split('?')[0]);
}
async function selectRecovery(page: Page, id: string) {
  const row = page.locator('li').filter({ hasText: `受付番号：${id}` });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'この申込の店舗情報を確認' }).click();
  await page.waitForURL('**/admin/onboarding?handoff=recovered');
}
async function submitSetup(page: Page, status: number, state: string) {
  await page.getByRole('checkbox').check();
  const response = await observeFacilitySetup(page,
    () => page.getByRole('button', { name: '施設を作成する', exact: true }).click());
  expect(response.status).toBe(status);
  const result = response.body;
  expect(result).toMatchObject({ success: true, state });
  await page.waitForURL(url => url.pathname === '/admin');
  return { facilityId: result.facilityId as string, slug: result.slug as string };
}

test('expired handoff -> verified recovery -> one draft -> listing without online booking', async ({ page }, info) => {
  await page.setExtraHTTPHeaders({ 'x-real-ip': `192.0.2.${160 + info.retry * 2 + (info.project.name === 'chromium' ? 0 : 1)}` });
  const db = localDb(); const owner = await identity(db);
  const name = `復旧掲載 ${randomUUID()}`; const id = await receipt(db, owner.email, name);
  const expired = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  const preparedExpiry = new Date(Date.parse(expired) + 60 * 60 * 1000).toISOString();
  const intent = await db.from('salon_submission_intents').insert({ id: randomUUID(), salon_id: id,
    proof_hash: 'a'.repeat(64), canonical_version: 1, hmac_scheme: 'proof-hkdf-sha256-v1', payload_hmac: 'b'.repeat(64),
    created_at: expired, committed_at: expired, prepare_expires_at: preparedExpiry });
  if (intent.error) throw new Error('Disposable expired handoff setup failed');
  await login(page, owner, '/register/recover');
  // Establish a real signed negative membership cache before creation.
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/mypage$/);
  const negativeHint = (await page.context().cookies()).find(cookie => cookie.name.startsWith('_cm_mbr_'));
  expect({ present: !!negativeHint, negative: negativeHint?.value.startsWith('0.'),
    httpOnly: negativeHint?.httpOnly, secure: negativeHint?.secure, path: negativeHint?.path })
    .toEqual({ present: true, negative: true, httpOnly: true, secure: true, path: '/admin' });
  await page.goto('/register/recover');
  // New browser has no receipt capability or tab handoff. Its verified identity
  // selects the original receipt without submitting another application.
  await selectRecovery(page, id);
  await expect(page.locator('#onboarding-facility-name')).toHaveValue(name);
  await expect(page.locator('#onboarding-facility-name')).toBeDisabled();
  const recovery = (await page.context().cookies()).find(cookie => cookie.name.startsWith('carelink_salon_recovery_'));
  expect({ present: !!recovery, httpOnly: recovery?.httpOnly, secure: recovery?.secure })
    .toEqual({ present: true, httpOnly: true, secure: true });
  const created = await submitSetup(page, 201, 'created');
  // Reproduce the cookie effect of an older pre-creation response arriving late.
  // The real middleware must recheck current DB membership, never trust denial.
  await page.context().addCookies([negativeHint!]);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin$/);
  const claimed = await db.from('salons').select('claimed_facility_id,claimed_by_user_id').eq('id', id).single();
  expect(claimed.error).toBeNull();
  expect(claimed.data).toEqual({ claimed_facility_id: created.facilityId, claimed_by_user_id: owner.id });
  const profile = await db.from('facility_profiles').select('status,business_hours').eq('id', created.facilityId).single();
  expect(profile.error).toBeNull(); expect(profile.data).toEqual({ status: 'draft', business_hours: null });
  const photos = await db.from('facility_photos').select('id').eq('facility_id', created.facilityId);
  expect(photos.error).toBeNull(); expect(photos.data).toEqual([]);
  // Real authorized status API; no artificial menu/staff/hours to pass a gate.
  const published = await page.request.patch(`/api/admin/settings?facility_id=${created.facilityId}&action=status`, {
    headers: { Origin: 'https://localhost:3000' }, data: { status: 'published' },
  });
  expect(published.status()).toBe(200);
  await page.goto(`/search?area=${encodeURIComponent('愛知県')}&keyword=${encodeURIComponent(name)}`);
  await expect(page.locator(`a[href="/facility/${created.slug}"]`).first()).toBeVisible();
  await page.goto(`/facility/${created.slug}/booking`);
  await expect(page.getByText('ネット予約は準備中です。ご予約については店舗へ直接お問い合わせください。')).toBeVisible();
  await expect(page.getByRole('link', { name: '店舗に電話する' })).toBeVisible();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const availability = await page.request.get(`/api/availability?facilityId=${created.facilityId}&year=${tomorrow.slice(0, 4)}&month=${Number(tomorrow.slice(5, 7))}`);
  expect(availability.status()).toBe(200);
  expect(await availability.json()).toEqual({ dates: {}, bookingAvailable: false });
  const slots = await page.request.get(`/api/slots?facilityId=${created.facilityId}&staffId=${randomUUID()}&date=${tomorrow}`);
  expect(slots.status()).toBe(200);
  expect(await slots.json()).toEqual({ slots: [], bookingAvailable: false });
  const anonymous = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const readiness = await anonymous.rpc('facility_booking_ready', { p_facility_id: created.facilityId });
  expect(readiness.error).toBeNull(); expect(readiness.data).toBe(false);
  // Re-selection + replay uses the same receipt and facility, not a second one.
  await page.goto('/register/recover'); await selectRecovery(page, id);
  expect(await submitSetup(page, 200, 'replay')).toEqual(created);
  const members = await db.from('facility_members').select('facility_id').eq('user_id', owner.id);
  expect(members.error).toBeNull(); expect(members.data).toEqual([{ facility_id: created.facilityId }]);
});

test('committed direct setup with lost response reloads membership without another POST', async ({ page }, info) => {
  await page.setExtraHTTPHeaders({ 'x-real-ip': `192.0.2.${200 + info.retry * 2 + (info.project.name === 'chromium' ? 0 : 1)}` });
  const db = localDb(); const owner = await identity(db);
  await login(page, owner, '/admin/onboarding');
  await page.goto('/admin'); await expect(page).toHaveURL(/\/mypage$/);
  const negativeHint = (await page.context().cookies()).find(cookie => cookie.name.startsWith('_cm_mbr_'));
  expect({ present: !!negativeHint, negative: negativeHint?.value.startsWith('0.'),
    httpOnly: negativeHint?.httpOnly, secure: negativeHint?.secure, path: negativeHint?.path })
    .toEqual({ present: true, negative: true, httpOnly: true, secure: true, path: '/admin' });
  const parameters = new URLSearchParams({ facility_name: `合成応答喪失 ${randomUUID()}`, business_type: 'ヘアサロン' });
  await page.goto(`/admin/onboarding?${parameters}`);
  await expect(page.getByRole('button', { name: '施設を作成する', exact: true })).toBeVisible();
  let setupRequests = 0;
  let committed: { status: number; success: boolean; state: string } | undefined;
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/facility/setup' && request.method() === 'POST') setupRequests += 1;
  });
  await page.route('**/api/facility/setup', async route => {
    const response = await route.fetch(); // Execute the real authorized DB transaction.
    const result = await response.json();
    committed = { status: response.status(), success: result.success, state: result.state };
    await route.abort('connectionfailed'); // No successful response reaches application code.
  });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '施設を作成する', exact: true }).click();
  await expect.poll(() => committed).toEqual({ status: 201, success: true, state: 'created' });
  await expect(page.getByText('作成結果を確認できませんでした。再読み込みして登録状況を確認してください',
    { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '再読み込みして登録状況を確認', exact: true })).toBeVisible();
  expect(setupRequests).toBe(1);
  // route.fetch shares Playwright's browser-context cookie jar and can apply
  // Set-Cookie before abort. Restore the original real signed denial so this
  // assertion actually models missing setup headers, not merely a lost body.
  await page.context().addCookies([negativeHint!]);
  expect((await page.context().cookies()).some(cookie => cookie.name === negativeHint!.name
    && cookie.value === negativeHint!.value)).toBe(true);
  await page.unroute('**/api/facility/setup');
  await page.reload();
  await expect(page).toHaveURL(/\/admin$/);
  expect(setupRequests).toBe(1);
  const members = await db.from('facility_members').select('facility_id,role').eq('user_id', owner.id);
  expect(members.error).toBeNull(); expect(members.data).toHaveLength(1);
  expect(members.data![0].role).toBe('owner');
});

test('platform explicit linkage -> owner recovery resolves same store, no additional claim or welcome', async ({ page, browser }, info) => {
  await page.setExtraHTTPHeaders({ 'x-real-ip': `192.0.2.${180 + info.retry * 2 + (info.project.name === 'chromium' ? 0 : 1)}` });
  const db = localDb(); const owner = await identity(db); const operator = await identity(db, true);
  const name = `重複合成店舗 ${randomUUID()}`;
  const canonicalId = await receipt(db, owner.email, name); const duplicateId = await receipt(db, owner.email, name);
  await login(page, owner, '/register/recover'); await selectRecovery(page, canonicalId);
  const created = await submitSetup(page, 201, 'created');
  // Separate real platform-only identity; no fabricated facility membership.
  const operatorContext = await browser.newContext({ baseURL: 'https://localhost:3000', ignoreHTTPSErrors: true,
    serviceWorkers: 'block', extraHTTPHeaders: { 'x-real-ip': `192.0.2.${200 + info.retry * 2 + (info.project.name === 'chromium' ? 0 : 1)}` } });
  try {
    const operatorPage = await operatorContext.newPage();
    await login(operatorPage, operator, '/admin/registrations');
    await operatorPage.getByLabel('未取り込みの受付番号', { exact: true }).fill(duplicateId);
    await operatorPage.getByLabel('店舗作成済みの受付番号', { exact: true }).fill(canonicalId);
    await operatorPage.getByRole('button', { name: '比較・記録を確認する' }).click();
    await expect(operatorPage.getByRole('button', { name: '元申込を保持して関連付ける' })).toBeDisabled();
    await operatorPage.getByRole('checkbox', { name: '同じ実店舗の重複申込であり、別支店ではありません' }).check();
    const linked = operatorPage.waitForResponse(r => new URL(r.url()).pathname === '/api/admin/registrations/duplicate'
      && r.request().method() === 'POST');
    await operatorPage.getByRole('button', { name: '元申込を保持して関連付ける' }).click();
    expect((await linked).status()).toBe(200);
    await expect(operatorPage.getByText('関連付け記録を確認しました。元申込・写真は保持し、新店舗・通知・公開は作成していません。')).toBeVisible();
  } finally { await operatorContext.close(); }
  await page.goto('/register/recover'); await selectRecovery(page, duplicateId);
  expect(await submitSetup(page, 200, 'linked')).toEqual(created);
  const untouched = await db.from('salons').select('claimed_facility_id,claimed_by_user_id,claimed_at').eq('id', duplicateId).single();
  expect(untouched.error).toBeNull();
  expect(untouched.data).toEqual({ claimed_facility_id: null, claimed_by_user_id: null, claimed_at: null });
  const links = await db.from('salon_duplicate_links').select('facility_id').eq('duplicate_receipt_id', duplicateId);
  expect(links.error).toBeNull(); expect(links.data).toEqual([{ facility_id: created.facilityId }]);
  const welcomes = await db.from('webhook_retry_queue').select('id').eq('webhook_type', 'facility_welcome').eq('payload->>user_id', owner.id);
  expect(welcomes.error).toBeNull(); expect(welcomes.data).toHaveLength(1);
});
