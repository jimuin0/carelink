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

  // docs/register-blocker-instructions.md §3 P0-5 の回帰 E2E。
  // signup/page.tsx:65 が supabase.auth.signUp() の data を破棄しており、成功時に
  // setToast のみで router.push が無かったため、メール確認が無効な設定（CI のローカル
  // Supabase は supabase/config.toml:205 で enable_confirmations = false）だと
  // セッションは張られているのに画面が「確認メールを送信しました」のまま静止していた。
  // ここは jsdom のユニットテスト（signUp をモック）では「本当に画面遷移するか」までは
  // 保証できないため、実 Supabase に対して実際に送信し着地することを見る。
  test('新規登録に成功すると /mypage へ遷移する（signUp後に画面が止まらない）', async ({ page }) => {
    await page.goto('/auth/signup');

    const uniqueEmail = `e2e-signup-${Date.now()}@example.com`;
    await page.fill('#signup-name', 'E2E登録太郎');
    await page.fill('#signup-email', uniqueEmail);
    await page.fill('#signup-phone', '09012345678');
    await page.selectOption('#signup-prefecture', { label: '東京都' });
    await page.fill('#signup-password', 'password123');
    await page.fill('#signup-password-confirm', 'password123');

    await page.getByRole('button', { name: '新規登録' }).click();

    // 修正前は redirect が発生せず /auth/signup に留まったまま（画面が「押しても反応しない」
    // ように見える不具合そのもの）。redirect 未指定時の既定値は safe-redirect.ts の
    // DEFAULT_REDIRECT（/mypage）。
    await page.waitForURL('**/mypage**', { timeout: 20000 });
    await expect(page).toHaveURL(/\/mypage/);
  });
});
