// 【監査M2/H1・神原さん決定 2026年7月22日】問診機能はローンチでは顧客に非表示
// （INTAKE_CUSTOMER_ENABLED=false）。旧テストは「ゲストが問診票を送信できる」ことを検証していたが、
// 方針変更に伴い、顧客導線が確実に封鎖されている（フォームが描画されず案内文を表示する）ことを
// 実行証明するテストへ更新する。CI の隔離 Supabase 上でのみ動作（本番不可侵）。
import { test, expect } from '@playwright/test';
import fs from 'fs';
import { INTAKE_FACILITY_FILE } from './intake.fixtures';

test('問診票は顧客に非表示（ゲート有効・フォーム描画なし）', async ({ page }) => {
  const { slug } = JSON.parse(fs.readFileSync(INTAKE_FACILITY_FILE, 'utf8')) as { slug: string };
  await page.goto(`/intake/${slug}`);

  // ゲート OFF のため「現在ご利用いただけません」を表示し、問診フォームは描画されない。
  await expect(page.getByText('この施設の問診票は現在ご利用いただけません')).toBeVisible({ timeout: 15000 });
  // 問診フォームの入力欄・送信ボタンが存在しない（顧客導線が封鎖されている）。
  await expect(page.locator('#intake-customer-name')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '問診票を送信する' })).toHaveCount(0);
});
