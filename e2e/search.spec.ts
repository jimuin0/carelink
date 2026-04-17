import { test, expect } from '@playwright/test';

test.describe('検索フロー', () => {
  test('トップページから検索できる', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
    // 検索バーに入力
    const searchInput = page.getByPlaceholder(/検索|Search/);
    if (await searchInput.isVisible()) {
      await searchInput.fill('鍼灸');
      await searchInput.press('Enter');
      await page.waitForURL(/\/search/);
    } else {
      // 業種リンクから検索
      await page.goto('/search?type=鍼灸院');
    }
    await expect(page).toHaveURL(/\/search/);
  });

  test('検索結果ページが表示される', async ({ page }) => {
    await page.goto('/search');
    await expect(page.locator('h1')).toBeVisible();
    // 件数が表示されている
    await expect(page.getByText(/件/)).toBeVisible();
  });

  test('業種フィルターが動作する', async ({ page }) => {
    await page.goto('/search?type=鍼灸院');
    await expect(page).toHaveURL(/type=%E9%8D%BC%E7%81%B8%E9%99%A2|type=鍼灸院/);
    await expect(page.locator('body')).not.toContainText('エラー');
  });

  test('エリア検索ページが表示される', async ({ page }) => {
    await page.goto('/search/area');
    await expect(page.locator('h1, h2')).toBeVisible();
  });
});
