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

test('platform operator records and corrects a synthetic registration classification, and hides and restores it', async ({ page, context }) => {
  test.setTimeout(120000);
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
  // The mobile cookie banner can cover management controls until a choice is made.
  await page.getByRole('button', { name: '必須のみ', exact: true }).click();
  await page.fill('#login-email', email); await page.fill('#login-password', password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.waitForURL(url => !url.pathname.startsWith('/auth/login'), { timeout: 20000 });
  await page.goto('/admin/registrations');
  await page.getByLabel('検索項目').selectOption('receipt'); await page.getByLabel('検索値').fill(receipt.receiptId);
  await page.getByRole('button', { name: '検索する' }).click();
  const classification = page.getByRole('combobox', { name: /の申込の種類$/ });
  await expect(classification).toHaveValue('unknown');
  await classification.selectOption('test'); await expect(page.getByText('テスト・検証用として記録しました')).toBeVisible();
  await expect(classification).toHaveValue('test');
  await classification.selectOption('unknown'); await expect(page.getByText('未確認として記録しました')).toBeVisible();
  await expect(classification).toHaveValue('unknown');
  // 一覧から隠す → 既定の一覧から消え、隠した申込の表示に出る → 戻すと既定の一覧に戻る。
  // 実 DB の PostgREST で、embed を使った絞り込み（隠した印の有無）が意図どおりに効くことを確かめる。
  await page.getByRole('button', { name: '一覧から隠す', exact: true }).click();
  await expect(page.getByText(/を一覧から隠しました/)).toBeVisible();
  await expect(page.getByText('この条件・ページに該当する登録申請はありません')).toBeVisible();
  await page.getByLabel('表示する申込').selectOption('hidden');
  await page.getByRole('button', { name: '検索する' }).click();
  await expect(page.getByText(`受付番号：${receipt.receiptId}`)).toBeVisible();
  await page.getByRole('button', { name: '一覧に戻す', exact: true }).click();
  await expect(page.getByText(/を一覧に戻しました/)).toBeVisible();
  await expect(page.getByText('一覧から隠した申込はありません')).toBeVisible();
  await page.getByLabel('表示する申込').selectOption('visible');
  await page.getByRole('button', { name: '検索する' }).click();
  await expect(page.getByText(`受付番号：${receipt.receiptId}`)).toBeVisible();
  // 「書類は後から」を付けて外す（確認画面を通る・DB に印が残る）。
  await page.getByRole('button', { name: '書類は後からにする', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '書類は後からにする', exact: true }).click();
  await expect(page.getByText(/を「書類は後から」にしました/)).toBeVisible();
  await page.getByRole('button', { name: '書類を先に必須に戻す', exact: true }).click();
  await expect(page.getByText(/書類の確認が済んでから公開する扱いに戻しました/)).toBeVisible();
  const deferral = await db.from('listing_verification_deferrals').select('deferred,revision').eq('salon_id', receipt.receiptId).single();
  expect(deferral.error).toBeNull(); expect(deferral.data).toEqual({ deferred: false, revision: 2 });
  const visibility = await db.from('salon_registration_visibility').select('hidden,revision').eq('salon_id', receipt.receiptId).single();
  expect(visibility.error).toBeNull(); expect(visibility.data).toEqual({ hidden: false, revision: 2 });
  const stored = await db.from('salon_registration_classifications').select('classification,revision').eq('salon_id', receipt.receiptId).single();
  expect(stored.error).toBeNull(); expect(stored.data).toEqual({ classification: 'unknown', revision: 2 });
  const after = await db.from('salons').select('id,status,claimed_facility_id').eq('id', receipt.receiptId).single();
  expect(after.error).toBeNull(); expect(after.data).toEqual(before.data);

  // 承認すると、確認のあとで、申込者へのお知らせメールのジョブが DB のトリガで 1 件だけ積まれる（2026-11-03）。
  // CI には送信の鍵が無いので、ここでは「積まれたこと」までを確かめる（実際の送信はしない）。
  await page.getByRole('button', { name: '承認', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('メールが送られます');
  await page.getByRole('button', { name: '承認する', exact: true }).click();
  await expect(page.getByText(/を承認しました。申込者へ続きの手順のメールを送ります/)).toBeVisible();
  const approvalJobs = await db.from('webhook_retry_queue').select('webhook_type,notification_kind,status')
    .eq('registration_id', receipt.receiptId).eq('notification_kind', 'approval');
  expect(approvalJobs.error).toBeNull();
  expect(approvalJobs.data).toEqual([{ webhook_type: 'salon_registration_email', notification_kind: 'approval', status: 'pending' }]);
  // 承認→審査中→承認と戻しても、同じ申込にお知らせメールを 2 回積まない。
  const reopened = await db.from('salons').update({ status: 'pending' }).eq('id', receipt.receiptId);
  expect(reopened.error).toBeNull();
  const reapproved = await db.from('salons').update({ status: 'approved' }).eq('id', receipt.receiptId);
  expect(reapproved.error).toBeNull();
  const again = await db.from('webhook_retry_queue').select('id').eq('registration_id', receipt.receiptId).eq('notification_kind', 'approval');
  expect(again.error).toBeNull(); expect(again.data).toHaveLength(1);
});
