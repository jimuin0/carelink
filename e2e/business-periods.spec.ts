import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

// This acceptance test creates synthetic data only inside the disposable CI DB.
test.beforeAll(() => {
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://localhost:54330'
    || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000'
    || !process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.RESEND_API_KEY) {
    throw new Error('Business-period acceptance requires isolated CI without send credentials');
  }
});
test.use({ serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' });

test('owner saves, reloads and publishes split, night, early and all-day hours independently', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `hours-${randomUUID()}@example.invalid`; const password = randomUUID();
  const identity = await db.auth.admin.createUser({ email, password, email_confirm: true });
  expect(identity.error).toBeNull();
  const id = randomUUID(); const slug = `hours-${id}`;
  const closed = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map(day => [day, null]));
  expect((await db.from('facility_profiles').insert({ id, name: '合成営業時間検証', slug, business_type: 'その他',
    prefecture: '愛知県', city: '西尾市', address: '合成町1', status: 'draft', business_hours: closed })).error).toBeNull();
  expect((await db.from('facility_members').insert({ facility_id: id, user_id: identity.data.user!.id, role: 'owner' })).error).toBeNull();
  await page.goto(`/auth/login?redirect=${encodeURIComponent(`/admin/settings?facility_id=${id}`)}`);
  await page.getByRole('button', { name: '必須のみ', exact: true }).click();
  await page.fill('#login-email', email); await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存する', exact: true })).toBeVisible();
  await page.getByLabel('月曜日に営業する', { exact: true }).check();
  const mon = page.getByRole('group', { name: '月曜日', exact: true });
  const cases = [
    { open: '09:00', close: '20:00' }, { open: '18:00', close: '05:00' },
    { open: '05:00', close: '12:00' }, { open: '00:00', close: '24:00' },
  ];
  for (const period of cases) {
    await mon.getByLabel('月曜日の開店時間', { exact: true }).fill(period.open);
    await mon.getByLabel('月曜日の閉店時間', { exact: true }).fill(period.close);
    const saved = page.waitForResponse(r => r.url().includes('/api/admin/settings') && r.request().method() === 'PATCH');
    await page.getByRole('button', { name: '保存する', exact: true }).click();
    expect((await saved).status()).toBe(200);
    expect((await db.from('facility_profiles').select('business_hours').eq('id', id).single()).data?.business_hours).toEqual({ ...closed, mon: period });
    await page.reload();
    await expect(mon.getByLabel('月曜日の閉店時間', { exact: true })).toHaveValue(period.close);
  }
  await mon.getByLabel('月曜日の開店時間', { exact: true }).fill('09:00');
  await mon.getByLabel('月曜日の閉店時間', { exact: true }).fill('12:30');
  await mon.getByRole('button', { name: '時間帯を追加', exact: true }).click();
  await mon.getByLabel('月曜日の2枠目の開店時間', { exact: true }).fill('15:00');
  await mon.getByLabel('月曜日の2枠目の閉店時間', { exact: true }).fill('18:20');
  const saved = page.waitForResponse(r => r.url().includes('/api/admin/settings') && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: '保存する', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await page.reload();
  await expect(mon.getByLabel('月曜日の2枠目の開店時間', { exact: true })).toHaveValue('15:00');
  const published = page.waitForResponse(r => r.url().includes('/api/admin/settings') && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: '公開する', exact: true }).click();
  expect((await published).status()).toBe(200);
  const visitor = await browser.newContext();
  try {
    const publicPage = await visitor.newPage(); await publicPage.goto(`/facility/${slug}`);
    await expect(publicPage.getByText('09:00 〜 12:30 ／ 15:00 〜 18:20', { exact: true }).first()).toBeVisible();
    const structured = await publicPage.locator('script[type="application/ld+json"]').allTextContents();
    expect(structured.join('')).toContain('15:00');
  } finally { await visitor.close(); }
  // Listing-only shops remain without menus/staff/booking activation.
  expect((await db.from('facility_menus').select('id').eq('facility_id', id)).data).toEqual([]);
});
