// オーナーが顧客台帳の顧客情報を編集できることを実行証明する（編集→保存→反映）。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。customers.setup の storageState を使う。
import { test, expect } from '@playwright/test';
import { CUSTOMERS_SEED } from './customers.fixtures';

test('オーナーが顧客台帳の顧客を編集できる（書き込み→反映）', async ({ page }) => {
  await page.goto('/admin/customers');

  // seed した顧客が一覧に出る（facility スコープで表示）。
  await expect(page.getByText(CUSTOMERS_SEED.customerName, { exact: true })).toBeVisible({ timeout: 15000 });

  // 「編集」→ モーダルで氏名を変更 → 「保存する」。
  await page.getByRole('button', { name: '編集', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#cust-name').fill(CUSTOMERS_SEED.editedName);
  await dialog.getByRole('button', { name: '保存する', exact: true }).click();

  // 成功トースト（customers テーブルに UPDATE 反映）。
  await expect(page.getByText('顧客情報を更新しました')).toBeVisible({ timeout: 15000 });
  // 一覧に編集後の氏名が反映される（書き込み永続化＋再読込）。
  await expect(page.getByText(CUSTOMERS_SEED.editedName, { exact: true })).toBeVisible({ timeout: 15000 });
});
