// 来院者 予約完走 E2E（売上の動脈）。匿名（未ログイン）で予約フローを最後まで通し、
// メニュー→スタッフ→日時→お客様情報→予約確定→完了ページ までが実際に動くことを検証する。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。
import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BOOKING_FACILITY_FILE, BOOKING_SEED } from './booking.fixtures';

test('来院者が予約を最後まで完走できる', async ({ page }) => {
  const { slug } = JSON.parse(fs.readFileSync(BOOKING_FACILITY_FILE, 'utf8')) as { slug: string };

  await page.goto(`/facility/${slug}/booking`);

  // Step 1: メニュー選択 → 次へ
  await page.getByRole('button', { name: new RegExp(BOOKING_SEED.menuName) }).click();
  await page.getByRole('button', { name: '次へ（スタッフ選択）' }).click();

  // Step 2: スタッフ＝指名なし（おまかせ）
  await page.getByRole('button', { name: '指名なし（おまかせ）' }).click();

  // Step 3: 日付（最初の候補＝翌日）→ 空き枠（最初の option）
  await page.locator('button').filter({ hasText: /^\d+\/\d+/ }).first().click();
  const firstSlot = page.getByRole('option').first();
  await firstSlot.waitFor({ timeout: 15000 });
  await firstSlot.click();
  await page.getByRole('button', { name: '次へ（確認・予約）' }).click();

  // Step 4: お客様情報 → 予約確定
  await page.fill('#booking-name', BOOKING_SEED.customerName);
  await page.fill('#booking-email', BOOKING_SEED.customerEmail);
  // 予約 POST のレスポンスを捕捉し、失敗時は status＋本文を明示して投げる（推測せず真因確定）。
  const bookingResp = page.waitForResponse((r) => r.url().includes('/api/booking') && r.request().method() === 'POST', { timeout: 20000 });
  await page.getByRole('button', { name: 'この内容で予約する' }).click();
  const resp = await bookingResp;
  if (!resp.ok()) {
    const body = await resp.text().catch(() => '(body 読取不可)');
    const reqBody = resp.request().postData() ?? '(req body なし)';
    throw new Error(`POST /api/booking failed: status=${resp.status()} resp=${body.slice(0, 200)} sent=${reqBody.slice(0, 400)}`);
  }

  // 完了ページへ遷移すること（予約が DB に作成され成功）
  await page.waitForURL('**/booking/complete**', { timeout: 20000 });
  await expect(page).toHaveURL(/booking\/complete/);
});

test('来院者がレビューを投稿できる', async ({ page }) => {
  const { slug } = JSON.parse(fs.readFileSync(BOOKING_FACILITY_FILE, 'utf8')) as { slug: string };
  await page.goto(`/facility/${slug}`);
  // 口コミタブ（role=tab・label「口コミ(N)」）を開く
  await page.getByRole('tab', { name: /口コミ/ }).click();
  // お名前＋5軸すべて5点を選択（全軸必須）
  await page.fill('#reviewer_name', 'E2Eレビュー太郎');
  const fiveStars = page.getByRole('button', { name: '5点を選択' });
  const n = await fiveStars.count();
  expect(n).toBeGreaterThanOrEqual(5);
  for (let i = 0; i < n; i++) await fiveStars.nth(i).click();
  // 投稿ボタン → 確認ダイアログの「投稿する」（"口コミを投稿する" との誤マッチを避け dialog+exact）
  await page.getByRole('button', { name: '口コミを投稿する' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '投稿する', exact: true }).click();
  await expect(page.getByText('口コミを投稿しました')).toBeVisible({ timeout: 15000 });
});
