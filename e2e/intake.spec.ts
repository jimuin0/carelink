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
  await page.getByRole('button', { name: '問診票を送信する' }).click();

  // 成功＝同ページ上で完了表示（書き込みが intake_form_responses に1行 INSERT される）。
  await expect(page.getByText('問診票を送信しました')).toBeVisible({ timeout: 15000 });
});
