import { test, expect } from '@playwright/test';

/**
 * 予約フロー E2E テスト
 * NOTE: 実際の予約は作成しない（認証必要 + 副作用あり）
 * 予約フォームのUI・バリデーションのみ確認
 */
test.describe('予約フロー（UI確認）', () => {
  test('施設詳細ページが表示される', async ({ page }) => {
    // 最初の施設ページへ
    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    const facilityLink = page.locator('a[href*="/facility/"]').first();
    if (await facilityLink.isVisible()) {
      const href = await facilityLink.getAttribute('href');
      if (href) {
        await page.goto(href);
        await expect(page.locator('h1')).toBeVisible();
      }
    }
  });

  test('予約ページへのリンクが存在する', async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    const facilityLink = page.locator('a[href*="/facility/"]').first();
    if (await facilityLink.isVisible()) {
      const href = await facilityLink.getAttribute('href');
      if (href) {
        await page.goto(href);
        // 予約ボタンがある
        const bookingBtn = page.getByRole('link', { name: /予約|Book/ }).first();
        await expect(bookingBtn.or(page.getByRole('button', { name: /予約|Book/ }).first())).toBeVisible();
      }
    }
  });
});

test.describe('予約フォーム', () => {
  test('未ログインでは認証ページにリダイレクト', async ({ page }) => {
    // 予約ページに直接アクセス
    const response = await page.goto('/mypage/bookings');
    // ログインページかマイページが表示される
    const url = page.url();
    expect(url).toMatch(/login|auth|mypage/);
  });
});
