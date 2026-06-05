import { test, expect } from '@playwright/test';

test.describe('認証フロー', () => {
  test('ログインページが表示される', async ({ page }) => {
    await page.goto('/auth/login');
    // ページ固有の見出し(h1)を role+名前で限定する。`h1, h2` だと共通フッターの
    // 見出しにも一致して曖昧（複数一致/フッター要素）になり誤判定するため。
    await expect(page.getByRole('heading', { name: 'ログイン' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toBeVisible();
  });

  test('新規登録ページが表示される', async ({ page }) => {
    await page.goto('/auth/signup');
    await expect(page.getByRole('heading', { name: '新規登録' })).toBeVisible();
  });

  test('空のフォーム送信でバリデーションエラー', async ({ page }) => {
    await page.goto('/auth/login');
    const submitBtn = page.getByRole('button', { name: 'ログイン', exact: true });
    await submitBtn.click();
    // フォームは noValidate + zod 検証のため HTML5 validity は常に valid になる。
    // 空送信時に react-hook-form が role="alert" のエラーを表示することを検証する（真の検証経路）。
    await expect(page.getByRole('alert').first()).toBeVisible();
  });

  test('無効なメールアドレスでエラー', async ({ page }) => {
    await page.goto('/auth/login');
    const emailInput = page.getByLabel(/メール|Email/).or(page.locator('input[type="email"]')).first();
    if (await emailInput.isVisible()) {
      await emailInput.fill('invalid-email');
      const submitBtn = page.getByRole('button', { name: 'ログイン', exact: true });
      await submitBtn.click();
      // エラー表示 or HTML5 validation
      const validity = await emailInput.evaluate((el: HTMLInputElement) => el.validity.valid);
      expect(validity).toBe(false);
    }
  });
});
