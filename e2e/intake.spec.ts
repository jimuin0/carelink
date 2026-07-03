// 来院者（ゲスト・未ログイン）が問診票を送信できることを実行証明する。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。
import { test, expect } from '@playwright/test';
import fs from 'fs';
import { INTAKE_FACILITY_FILE, INTAKE_SEED } from './intake.fixtures';

test('ゲストが問診票を送信できる', async ({ page }) => {
  const { slug } = JSON.parse(fs.readFileSync(INTAKE_FACILITY_FILE, 'utf8')) as { slug: string };
  await page.goto(`/intake/${slug}`);

  // 質問ゼロのテンプレートなので必須は氏名のみ。氏名を入力して送信。
  await page.fill('#intake-customer-name', INTAKE_SEED.customerName);
  // POST /api/intake の 2xx を成功シグナルに（click より前に登録）。完了表示は永続パネルだが、API 2xx を
  // 併せて待つことで送信→再描画のレースを解消する。
  const intakePost = page.waitForResponse(
    (r) => r.url().includes('/api/intake') && r.request().method() === 'POST' && r.ok(),
    { timeout: 15000 }
  );
  await page.getByRole('button', { name: '問診票を送信する' }).click();
  await intakePost;
  // 成功＝同ページ上で完了表示（書き込みが intake_form_responses に1行 INSERT される・永続 DOM）。
  await expect(page.getByText('問診票を送信しました')).toBeVisible({ timeout: 15000 });
});
