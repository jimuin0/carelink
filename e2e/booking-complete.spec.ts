// 来院者 予約完走 E2E（売上の動脈）。匿名（未ログイン）で予約フローを最後まで通し、
// メニュー・クーポン→日時（週×時間の空き状況カレンダー）→お客様情報→予約確定→完了ページ
// までが実際に動くことを検証する（HPB風レイアウトへの刷新後の3ステップ構成）。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。
import { test, expect } from '@playwright/test';
import fs from 'fs';
import { BOOKING_FACILITY_FILE, BOOKING_SEED } from './booking.fixtures';

test('来院者が予約を最後まで完走できる', async ({ page }) => {
  const { slug } = JSON.parse(fs.readFileSync(BOOKING_FACILITY_FILE, 'utf8')) as { slug: string };

  await page.goto(`/facility/${slug}/booking`);

  // Step 1: メニュー選択 → 次へ（日時を選ぶ）
  await page.getByRole('button', { name: new RegExp(BOOKING_SEED.menuName) }).click();
  await page.getByRole('button', { name: '次へ（日時を選ぶ）' }).click();

  // Step 2: 日時＝週×時間マトリクス。指名なし(既定)のまま、最初に見つかった空きセル
  // （disabled でない=◎○△のいずれか）をクリックする。fixture はスタッフ1名を全曜日
  // フルスケジュールで seed するため、表示週内に必ず空きセルが存在する。
  const availableCell = page.locator('table button:not([disabled])').first();
  await availableCell.waitFor({ timeout: 15000 });
  await availableCell.click();
  await page.getByRole('button', { name: '次へ（確認・予約）' }).click();

  // Step 3: お客様情報 → 予約確定
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
