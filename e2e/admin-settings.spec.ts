// オーナーが店舗設定（営業時間など）を保存できることを実行証明する。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。admin-batch.setup の storageState を使う。
import { test, expect } from '@playwright/test';

test('オーナーが店舗設定を保存できる', async ({ page }) => {
  await page.goto('/admin/settings');

  // 保存ボタン（ヘッダー「保存する」）が出る＝設定がロードされた。クリックで PATCH /api/admin/settings。
  // 営業時間は HH:MM の time input で zod も HH:MM 厳格（秒禁止）＝形式不一致バグは無い。
  const saveBtn = page.getByRole('button', { name: '保存する', exact: true });
  await expect(saveBtn).toBeVisible({ timeout: 15000 });
  // 保存 PATCH /api/admin/settings（action クエリ無し。?action=status の公開/非公開切替 PATCH とは別物）
  // の 2xx を成功シグナルにする（click より前に登録）。この spec は永続 DOM 確認を持たず、約4.3秒で
  // 消えるトーストが唯一証拠で最も脆かったため、非揮発の API 2xx を主判定に据える。
  const settingsPatch = page.waitForResponse(
    (r) => r.url().includes('/api/admin/settings') && !r.url().includes('action=status') && r.request().method() === 'PATCH' && r.ok(),
    { timeout: 15000 }
  );
  await saveBtn.click();
  await settingsPatch;
});
