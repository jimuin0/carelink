// 来院者（一般ユーザー）が自分の予約をマイページからキャンセルできることを実行証明する。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。
import { test, expect } from '@playwright/test';
import fs from 'fs';
import { VISITOR_BOOKING_FILE } from './visitor-cancel.fixtures';

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
