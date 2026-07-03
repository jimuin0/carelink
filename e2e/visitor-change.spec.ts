// 来院者（一般ユーザー）が自分の予約の日時を変更できることを実行証明する。
// 新しい日付→空き枠を選んで「変更する」→ 成功トースト（書き込み反映）。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。
import { test, expect } from '@playwright/test';
import fs from 'fs';
import { VISITOR_CHANGE_BOOKING_FILE } from './visitor-change.fixtures';

test('来院者が自分の予約の日時を変更できる', async ({ page }) => {
  const { id } = JSON.parse(fs.readFileSync(VISITOR_CHANGE_BOOKING_FILE, 'utf8')) as { id: string };
  await page.goto(`/mypage/bookings/${id}/change`);
  await expect(page.getByRole('heading', { name: '予約日時の変更' })).toBeVisible();

  // 新しい日付を選択（「新しい日付を選択」カード内の日付ボタン）。全曜日スケジュール seed のため
  // どの未来日でも空き枠が出る。先頭付近の日付を選ぶ（4番目＝十分先で確実に空き枠あり）。
  const dateCard = page.locator('div.bg-white', { has: page.getByRole('heading', { name: '新しい日付を選択', exact: true }) });
  await dateCard.getByRole('button').nth(3).click();

  // 空き枠が出るのを待ち、先頭の枠を選択（「時間を選択」カード内）。
  const slotCard = page.locator('div.bg-white', { has: page.getByRole('heading', { name: '時間を選択', exact: true }) });
  const firstSlot = slotCard.getByRole('button').first();
  await expect(firstSlot).toBeVisible({ timeout: 15000 });
  await firstSlot.click();

  // 「{date} {time}に変更する」ボタンで確定。成功トーストは書き込み反映の 1.5s 後に一覧へ遷移するため
  // トースト DOM が消えるレースが起きやすい。POST /api/booking/{id}/change の 2xx を遷移前に確定させる
  //（click より前に登録）ことでレースを構造的に解消し、非揮発シグナルを主判定にする。
  const changePost = page.waitForResponse(
    (r) => r.url().includes('/api/booking/') && r.url().includes('/change') && r.request().method() === 'POST' && r.ok(),
    { timeout: 15000 }
  );
  await page.getByRole('button', { name: /に変更する$/ }).click();
  await changePost;
});
