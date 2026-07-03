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

  // 「{date} {time}に変更する」ボタンで確定（書き込みが反映され 1.5s 後に一覧へ遷移）。
  // 成功判定は、4秒で自動消滅し CI では消滅後にポーリングして flake する成功トーストではなく
  // API 応答＋その後の一覧ページへの遷移（永続 DOM 状態）で行う（唯一の副作用ゼロな決定的判定）。
  await Promise.all([
    page.waitForResponse((r) => /\/api\/booking\/[^/]+\/change$/.test(r.url()) && r.request().method() === 'POST' && r.ok()),
    page.getByRole('button', { name: /に変更する$/ }).click(),
  ]);
  await page.waitForURL('**/mypage/bookings', { timeout: 15000 });
});
