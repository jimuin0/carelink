import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { observeFacilitySetup } from './facility-setup-observer';

test.beforeAll(() => {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true'
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://localhost:54330'
    || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000'
    || process.env.SALON_REGISTRATION_V2_ENABLED !== 'true'
    || !process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.RESEND_API_KEY
    || process.env.SLACK_BOT_TOKEN || process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK) {
    throw new Error('Three-store verification requires disposable local CI without sending credentials');
  }
});
test.use({ serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 30_000, navigationTimeout: 30_000 });

async function apply(page: Page, name: string, email: string, address: string) {
  await page.goto('/register');
  await expect(page.locator('#reg-facility-name')).toBeEnabled();
  await page.fill('#reg-facility-name', name);
  await page.selectOption('#reg-business-type', { label: 'ヘアサロン' });
  await page.fill('#reg-rep-name', '合成代表');
  await page.fill('#reg-email', email);
  await page.fill('#reg-phone', '09012345678');
  await page.getByRole('button', { name: '次へ' }).click();
  await expect(page.locator('#reg-address')).toBeVisible();
  await page.fill('#reg-address', address);
  await page.getByRole('button', { name: '次へ' }).click();
  await expect(page.locator('#reg-desired-start-date')).toBeVisible();
  await page.selectOption('#reg-desired-start-date', { value: 'immediately' });
  await page.locator('label', { hasText: '国家資格が必要な施術' }).locator('input[type="checkbox"]').check();
  await page.locator('label', { hasText: '利用規約' }).locator('input[type="checkbox"]').check();
  await page.getByRole('button', { name: '登録する', exact: true }).click();
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/salons/commit' && r.request().method() === 'POST');
  await page.getByRole('button', { name: '送信する', exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(201);
  const body = await result.json();
  expect(body.state).toBe('committed');
  await expect(page.getByRole('heading', { name: '掲載申込を受け付けました' })).toBeVisible();
  return body.receiptId as string;
}

test('one owner applies, signs up, adds and publishes three distinct stores', async ({ page }, info) => {
  test.setTimeout(240_000);
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = randomUUID();
  const email = `three-store-${suffix}@example.invalid`;
  const password = `Aa1-${randomUUID()}`;
  const names = [1, 2, 3].map(i => `合成店舗${i}-${suffix}`);
  const ids: string[] = [];
  let ownerId: string | undefined;
  await page.setExtraHTTPHeaders({ 'x-real-ip': `192.0.2.${100 + info.retry * 2 + (info.project.name === 'chromium' ? 0 : 1)}` });
  await page.goto('/register');
  await page.getByRole('button', { name: '必須のみ', exact: true }).click();

  for (let index = 0; index < names.length; index++) {
    console.log(`Verifying store ${index + 1}: application`);
    const receiptId = await apply(page, names[index], `three-store-${suffix}@example.invalid`, `愛知県西尾市合成町${index + 1}`);
    console.log(`Verifying store ${index + 1}: account handoff`);
    if (index === 0) {
      await page.getByRole('link', { name: '店舗アカウントを作成する' }).click();
      await page.fill('#signup-name', '合成担当');
      await page.fill('#signup-email', email);
      await page.fill('#signup-phone', '09012345678');
      await page.selectOption('#signup-prefecture', { label: '愛知県' });
      await page.fill('#signup-password', password);
      await page.fill('#signup-password-confirm', password);
      await page.getByRole('checkbox', { name: '利用規約およびプライバシーポリシーに同意する（必須）' }).check();
      await page.getByRole('button', { name: '店舗アカウントを作成', exact: true }).click();
    } else {
      await page.getByRole('link', { name: '既存アカウントでログインする' }).click();
    }
    await page.waitForURL('**/admin/onboarding?handoff=registration', { timeout: 30_000 });
    console.log(`Verifying store ${index + 1}: setup`);
    await expect(page.locator('#onboarding-facility-name')).toHaveValue(names[index]);
    await page.getByRole('checkbox').check();
    const setup = await observeFacilitySetup(page, () => page.getByRole('button', { name: '店舗を作成する', exact: true }).click());
    expect(setup.status).toBe(201);
    expect(setup.body).toMatchObject({ state: 'created', success: true });
    const facilityId = setup.body.facilityId as string;
    expect(facilityId).not.toBeFalsy();
    expect(ids).not.toContain(facilityId);
    ids.push(facilityId);
    await page.waitForURL(url => url.pathname === '/admin', { timeout: 30_000 });
    console.log(`Verifying store ${index + 1}: ownership`);
    const claimed = await db.from('salons').select('claimed_by_user_id,claimed_facility_id').eq('id', receiptId).single();
    expect(claimed.error).toBeNull();
    expect(claimed.data?.claimed_facility_id).toBe(facilityId);
    if (index === 0) ownerId = claimed.data?.claimed_by_user_id;
    expect(ownerId).toBeTruthy();
    expect(claimed.data?.claimed_by_user_id).toBe(ownerId);
  }
  const membership = await db.from('facility_members').select('facility_id,role').eq('user_id', ownerId!);
  expect(membership.error).toBeNull();
  expect(membership.data).toHaveLength(3);
  expect(membership.data).toEqual(expect.arrayContaining(ids.map(facility_id => ({ facility_id, role: 'owner' }))));

  await page.goto('/admin');
  await expect(page.getByText('編集する店舗を選択してください')).toBeVisible();
  for (const name of names) await expect(page.getByRole('link', { name, exact: true })).toBeVisible();

  for (let index = 0; index < ids.length; index++) {
    console.log(`Verifying store ${index + 1}: settings and publication`);
    await page.goto(`/admin/settings?facility_id=${ids[index]}`);
    await expect(page.getByRole('button', { name: '保存する', exact: true })).toBeVisible();
    await page.getByLabel('月曜日に営業する', { exact: true }).check();
    const monday = page.getByRole('group', { name: '月曜日', exact: true });
    await monday.getByLabel('月曜日の開店時間', { exact: true }).fill('09:00');
    await monday.getByLabel('月曜日の閉店時間', { exact: true }).fill('18:00');
    await page.getByRole('button', { name: '保存する', exact: true }).click();
    await expect(page.getByRole('button', { name: '公開する', exact: true })).toBeVisible();
    const published = page.waitForResponse(r => r.url().includes('/api/admin/settings') && r.url().includes('action=status') && r.request().method() === 'PATCH');
    await page.getByRole('button', { name: '公開する', exact: true }).click();
    expect((await published).status()).toBe(200);
    await expect(page.getByText('公開中', { exact: true })).toBeVisible();
    const profile = await db.from('facility_profiles').select('status,slug').eq('id', ids[index]).single();
    expect(profile.error).toBeNull();
    expect(profile.data?.status).toBe('published');
    await page.goto(`/facility/${profile.data!.slug}`);
    await expect(page.getByRole('heading', { name: names[index], exact: true })).toBeVisible();
  }
});
