// オーナーが店舗設定（営業時間など）を保存できることを実行証明する。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。admin-batch.setup の storageState を使う。
import { test, expect } from '@playwright/test';

test('オーナーが店舗設定を保存できる', async ({ page }) => {
  await page.goto('/admin/settings');

  // 保存ボタン（ヘッダー「保存する」）が出る＝設定がロードされた。クリックで PATCH /api/admin/settings。
  // 営業時間は HH:MM の time input で zod も HH:MM 厳格（秒禁止）＝形式不一致バグは無い。
  const saveBtn = page.getByRole('button', { name: '保存する', exact: true });
  await expect(saveBtn).toBeVisible({ timeout: 15000 });
  await saveBtn.click();

  // 成功トースト（書き込みが facility_profiles に反映・updated_at 更新）。
  await expect(page.getByText('施設情報を保存しました')).toBeVisible({ timeout: 15000 });
});
