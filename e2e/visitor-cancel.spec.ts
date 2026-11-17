// 来院者（一般ユーザー）が自分の予約をマイページからキャンセルできることを実行証明する。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。
import { test, expect } from '@playwright/test';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { VISITOR_BOOKING_FILE, VISITOR_MEMBER_BOOKING_MENU } from './visitor-cancel.fixtures';

test('会員が新しく予約し、同じ予約を本人履歴で確認してキャンセルできる', async ({ page }) => {
  test.setTimeout(60_000);
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://localhost:54330'
    || process.env.PLAYWRIGHT_BASE_URL !== 'https://localhost:3000') {
    throw new Error('member booking acceptance requires the managed disposable HTTPS CI lifecycle');
  }
  const fixture = JSON.parse(fs.readFileSync(VISITOR_BOOKING_FILE, 'utf8')) as {
    facilityId: string; slug: string; userId: string; email: string;
  };
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } });

  await page.goto(`/facility/${fixture.slug}/booking`);
  await page.getByRole('button', { name: new RegExp(VISITOR_MEMBER_BOOKING_MENU) }).click();
  await page.getByRole('button', { name: '次へ（日時を選ぶ）' }).click();
  await page.locator('table button:not([disabled])').first().click();
  await page.getByRole('button', { name: '次へ（確認・予約）' }).click();
  await page.fill('#booking-name', 'E2E会員予約本人');
  await page.fill('#booking-email', fixture.email);
  const acceptedResponse = page.waitForResponse(r => r.url().endsWith('/api/booking')
    && r.request().method() === 'POST' && r.request().headers()['x-booking-action'] === 'create');
  await page.getByRole('button', { name: 'この内容で予約する' }).click();
  const response = await acceptedResponse;
  expect(response.status()).toBe(200);
  const receipt = await response.json();
  expect(receipt.state).toBe('accepted');
  expect(receipt.bookingId).toMatch(/^[a-f0-9-]{36}$/);
  expect(receipt.operationId).toBe(response.request().headers()['idempotency-key']);
  await expect(page).toHaveURL(/booking\/complete/);

  const created = await db.from('bookings').select('user_id,facility_id,total_price').eq('id', receipt.bookingId).single();
  expect(created.error).toBeNull();
  expect(created.data).toEqual({ user_id: fixture.userId, facility_id: fixture.facilityId, total_price: 5000 });
  await page.goto('/mypage/bookings');
  await page.locator(`a[href="/mypage/bookings/${receipt.bookingId}"]`).click();
  await expect(page.getByRole('button', { name: 'この予約をキャンセル', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'この予約をキャンセル', exact: true }).click();
  await Promise.all([
    page.waitForResponse(r => r.url().endsWith(`/api/booking/${receipt.bookingId}/cancel`)
      && r.request().method() === 'POST' && r.ok()),
    page.getByRole('button', { name: 'キャンセルする', exact: true }).click(),
  ]);
  await expect(page.getByRole('button', { name: 'この予約をキャンセル', exact: true })).toHaveCount(0);
  const cancelled = await db.from('bookings').select('status').eq('id', receipt.bookingId).single();
  expect(cancelled.error).toBeNull();
  expect(cancelled.data?.status).toBe('cancelled');
});

test('来院者が自分の予約をキャンセルできる', async ({ page }) => {
  const { id } = JSON.parse(fs.readFileSync(VISITOR_BOOKING_FILE, 'utf8')) as { id: string };
  await page.goto(`/mypage/bookings/${id}`);

  // キャンセルボタン → 確認ダイアログ → 確定。
  // 成功判定は、4秒で自動消滅し CI では消滅後にポーリングして flake する成功トーストではなく
  // API 応答＋status='cancelled' 反映で「この予約をキャンセル」ボタン自体が消えることで行う
  // （唯一の副作用ゼロな決定的判定）。
  await page.getByRole('button', { name: 'この予約をキャンセル' }).click();
  await Promise.all([
    page.waitForResponse((r) => /\/api\/booking\/[^/]+\/cancel$/.test(r.url()) && r.request().method() === 'POST' && r.ok()),
    page.getByRole('button', { name: 'キャンセルする' }).click(),
  ]);
  await expect(page.getByRole('button', { name: 'この予約をキャンセル' })).toHaveCount(0, { timeout: 15000 });
});
