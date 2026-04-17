import { test, expect } from '@playwright/test';

test.describe('施設詳細ページ', () => {
  test('存在しないスラッグで404', async ({ page }) => {
    const response = await page.goto('/facility/this-slug-does-not-exist-xyz-123');
    // 404またはnot foundページ
    expect([404, 200]).toContain(response?.status());
    if (response?.status() === 200) {
      await expect(page.locator('body')).toContainText(/見つかりません|Not Found|404/i);
    }
  });

  test('OGイメージAPIが動作する', async ({ page }) => {
    const response = await page.goto('/api/og?title=テスト施設&type=鍼灸院');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['content-type']).toMatch(/image/);
  });
});

test.describe('API ヘルスチェック', () => {
  test('/api/health が 200 を返す', async ({ page }) => {
    const response = await page.goto('/api/health');
    expect(response?.status()).toBe(200);
  });
});
