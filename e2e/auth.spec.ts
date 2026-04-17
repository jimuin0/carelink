import { test, expect } from '@playwright/test';

test.describe('認証フロー', () => {
  test('ログインページが表示される', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.locator('h1, h2')).toBeVisible();
    await expect(page.getByRole('button', { name: /ログイン|Login|サインイン/ })).toBeVisible();
  });

  test('新規登録ページが表示される', async ({ page }) => {
    await page.goto('/auth/signup');
    await expect(page.locator('h1, h2')).toBeVisible();
  });

  test('空のフォーム送信でバリデーションエラー', async ({ page }) => {
    await page.goto('/auth/login');
    const submitBtn = page.getByRole('button', { name: /ログイン|Login|サインイン/ });
    await submitBtn.click();
    // メールかパスワードフィールドのエラーが表示される
    const emailInput = page.getByLabel(/メール|Email/);
    if (await emailInput.isVisible()) {
      // HTML5 required attribute
      const validity = await emailInput.evaluate((el: HTMLInputElement) => el.validity.valid);
      expect(validity).toBe(false);
    }
  });

  test('無効なメールアドレスでエラー', async ({ page }) => {
    await page.goto('/auth/login');
    const emailInput = page.getByLabel(/メール|Email/).or(page.locator('input[type="email"]')).first();
    if (await emailInput.isVisible()) {
      await emailInput.fill('invalid-email');
      const submitBtn = page.getByRole('button', { name: /ログイン|Login|サインイン/ });
      await submitBtn.click();
      // エラー表示 or HTML5 validation
      const validity = await emailInput.evaluate((el: HTMLInputElement) => el.validity.valid);
      expect(validity).toBe(false);
    }
  });
});
