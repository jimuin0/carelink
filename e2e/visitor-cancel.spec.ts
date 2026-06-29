// 来院者（一般ユーザー）が自分の予約をマイページからキャンセルできることを実行証明する。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。
import { test, expect } from '@playwright/test';
import fs from 'fs';
import { VISITOR_BOOKING_FILE } from './visitor-cancel.fixtures';

test('来院者が自分の予約をキャンセルできる', async ({ page }) => {
  const { id } = JSON.parse(fs.readFileSync(VISITOR_BOOKING_FILE, 'utf8')) as { id: string };
  await page.goto(`/mypage/bookings/${id}`);

  // キャンセルボタン → 確認ダイアログ → 確定
  await page.getByRole('button', { name: 'この予約をキャンセル' }).click();
  await page.getByRole('button', { name: 'キャンセルする' }).click();

  // 成功トースト or ステータスがキャンセルに変わる（書き込み反映）
  await expect(page.getByText('予約をキャンセルしました')).toBeVisible({ timeout: 15000 });
});
