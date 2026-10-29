import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { prepareSalonIntent } from '../src/lib/salon-submission-intent';
import { commitSalonSubmission } from '../src/lib/salon-submission-commit';

// Real Auth, admin UI, API and DB, but only the managed disposable CI stack.
// Provider credentials must be absent; no real recipient or hosted data is used.
test.use({ serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' });
test.beforeAll(() => {
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://localhost:54330'
    || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000'
    || !process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.RESEND_API_KEY
    || process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK) throw new Error('Classification fixture requires isolated CI without provider credentials');
});

test('platform operator records and corrects a synthetic registration classification', async ({ page, context }) => {
  test.setTimeout(60000);
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === 'https://localhost:3000' || url.origin === 'https://localhost:54330' ? route.continue() : route.abort();
  });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = randomUUID();
  const email = `classification-admin-${suffix}@example.invalid`, password = `Local-${randomUUID()}Aa9!`;
  const prepared = await prepareSalonIntent(db);
  if (prepared.state !== 'prepared') throw new Error('Synthetic intent preparation failed');
  const receipt = await commitSalonSubmission(db, {
    intentId: prepared.intentId,
    registration: { facility_name: `Synthetic ${suffix}`, business_type: 'ヘアサロン', representative_name: 'Synthetic', contact_name: 'Synthetic', email: `classification-${suffix}@example.invalid`, phone: '09000000000', source: 'register' },
    photoIds: [], consent: { terms_agreed: true, license_warranted: true },
  }, prepared.proof);
  if (receipt.state !== 'committed') throw new Error('Synthetic receipt creation failed');
  const user = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error || !user.data.user) throw new Error('Synthetic operator creation failed');
  const promoted = await db.from('profiles').update({ is_platform_admin: true }).eq('id', user.data.user.id);
  if (promoted.error) throw new Error('Synthetic operator setup failed');
  const before = await db.from('salons').select('id,status,claimed_facility_id').eq('id', receipt.receiptId).single();
  if (before.error) throw new Error('Synthetic receipt read failed');
  await page.goto('/auth/login?redirect=/admin/registrations');
  await page.fill('#login-email', email); await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.waitForURL(url => !url.pathname.startsWith('/auth/login'), { timeout: 20000 });
  await page.goto('/admin/registrations');
  await page.getByLabel('検索項目').selectOption('receipt'); await page.getByLabel('検索値').fill(receipt.receiptId);
  await page.getByRole('button', { name: '検索する' }).click();
  await expect(page.getByText('申込区分：未確認')).toBeVisible();
  await page.getByRole('button', { name: '試験と記録' }).click(); await expect(page.getByText('申込区分：試験')).toBeVisible();
  await page.getByRole('button', { name: '未確認に戻す' }).click(); await expect(page.getByText('申込区分：未確認')).toBeVisible();
  const stored = await db.from('salon_registration_classifications').select('classification,revision').eq('salon_id', receipt.receiptId).single();
  expect(stored.error).toBeNull(); expect(stored.data).toEqual({ classification: 'unknown', revision: 2 });
  const after = await db.from('salons').select('id,status,claimed_facility_id').eq('id', receipt.receiptId).single();
  expect(after.error).toBeNull(); expect(after.data).toEqual(before.data);
});
