import { test, expect } from '@playwright/test';

// 表示だけを検査し、認証・メール送信・店舗データの変更は行わない。
test('店舗ログイン→再設定と利用者ログインで配色・外枠が切り替わる', async ({ page }) => {
  await page.goto('/auth/login?redirect=/admin');
  await expect(page.locator('.theme-ecru').first()).toBeVisible();
  await expect(page.locator('header')).toHaveCSS('background-color', 'rgb(247, 243, 236)');
  await expect(page.locator('header').getByRole('link', { name: 'CareLink', exact: true })).toHaveCSS('color', 'rgb(3, 105, 161)');
  await page.getByRole('link', { name: 'パスワードをお忘れの方' }).click();
  await expect(page).toHaveURL(/forgot-password\?redirect=%2Fadmin/);
  await expect(page.getByRole('button', { name: 'リセットメールを送信' })).toHaveCSS('background-color', 'rgb(142, 106, 97)');
  await page.getByRole('link', { name: 'ログインページに戻る' }).click();
  await expect(page).toHaveURL(/login\?redirect=%2Fadmin/);
  // The store return navigation may still be settling in Mobile Safari.
  // Check the visitor theme in a separate page so its navigation cannot race
  // with the store page's pending client transition.
  const visitorPage = await page.context().newPage();
  await visitorPage.goto('/auth/login?redirect=/mypage', { waitUntil: 'domcontentloaded' });
  await expect(visitorPage.locator('.theme-ecru')).toHaveCount(0);
  await expect(visitorPage.getByRole('button', { name: 'ログイン', exact: true })).toHaveCSS('background-color', 'rgb(3, 105, 161)');
});

test('店舗アカウント作成と復旧にも同じテーマを適用する', async ({ page }) => {
  await page.goto('/auth/signup?redirect=/admin/onboarding?handoff=registration');
  await expect(page.locator('header')).toHaveCSS('background-color', 'rgb(247, 243, 236)');
  await page.goto('/register/recover');
  // 未認証なら店舗向けログインへ誘導されても、店舗テーマが続くこと。
  await expect(page.locator('.theme-ecru').first()).toBeVisible();
  await expect(page.locator('header')).toHaveCSS('background-color', 'rgb(247, 243, 236)');
});
