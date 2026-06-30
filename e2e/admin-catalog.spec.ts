// オーナーがカタログ（症例カタログ）を作成できることを実行証明する（作成→一覧反映）。
// POST は src/app/admin/catalog/new/page.tsx:35（treatment_catalogs へ title/description/tags を保存）。
// CI の隔離 Supabase 上でのみ動作（本番不可侵）。admin-batch.setup の storageState（owner 認証）を共有して使う。
import { test, expect } from '@playwright/test';

test('オーナーがカタログを作成できる（書き込み→一覧反映）', async ({ page }) => {
  // CI の retries で同一 storageState（同一施設）を再利用するため、毎回ユニーク名で衝突を避ける。
  const ts = `${Date.now()}`;
  const catalogTitle = `E2Eカタログ_${ts}`;

  // 新規追加フォームでタイトルのみ入力（説明/タグは任意）。
  // 固定オーバーレイ（Cookie 同意バナー/AIサポート）の hit-test 被り対策で focus→Enter で押す。
  await page.goto('/admin/catalog/new');
  await page.locator('#catalog-title').fill(catalogTitle);
  const createBtn = page.getByRole('button', { name: 'カタログを追加', exact: true });
  await createBtn.scrollIntoViewIfNeeded();
  await createBtn.press('Enter');

  // POST /api/admin/catalog 成功で一覧へ router.push → 作成したカタログ（title）が表示される（永続化）。
  await expect(page).toHaveURL(/\/admin\/catalog$/, { timeout: 15000 });
  await expect(page.getByText(catalogTitle, { exact: true })).toBeVisible({ timeout: 15000 });
});
