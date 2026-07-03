// 来院者（一般ユーザー）が自分の予約をマイページからキャンセルできることを実行証明する。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。
import { test } from '@playwright/test';
import fs from 'fs';
import { VISITOR_BOOKING_FILE } from './visitor-cancel.fixtures';

test('来院者が自分の予約をキャンセルできる', async ({ page }) => {
  const { id } = JSON.parse(fs.readFileSync(VISITOR_BOOKING_FILE, 'utf8')) as { id: string };
  await page.goto(`/mypage/bookings/${id}`);

  // キャンセルボタン → 確認ダイアログ → 確定
  await page.getByRole('button', { name: 'この予約をキャンセル' }).click();
  // POST /api/booking/{id}/cancel の 2xx を成功シグナルに（確定 click より前に登録）。揮発トースト依存を
  // 外し、非揮発の API 2xx を主判定にする。
  const cancelPost = page.waitForResponse(
    (r) => r.url().includes('/api/booking/') && r.url().includes('/cancel') && r.request().method() === 'POST' && r.ok(),
    { timeout: 15000 }
  );
  await page.getByRole('button', { name: 'キャンセルする' }).click();
  await cancelPost;
});
