import { test, expect } from '@playwright/test';

/**
 * 店舗の登録入口は /register の 1 本（2026年10月23日 神原さん決定）。
 * 旧 LP（/salon とその配下）と、別フォームだった /recruit は、外部リンク・営業資料・検索結果からの
 * 流入を落とさないよう /register へ恒久転送（308）する。設定の文字列は
 * src/__tests__/shop-landing-unification.test.ts が固定し、ここでは実際の HTTP 応答を確かめる。
 */
test.describe('店舗の登録入口の転送', () => {
  for (const path of ['/recruit', '/salon', '/salon/cases', '/salon/demo']) {
    test(`${path} は /register へ 308 で転送する`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(308);
      expect(new URL(response.headers().location, 'http://localhost').pathname).toBe('/register');
    });
  }

  test('/recruit を開くと /register の申込フォームに着く', async ({ page }) => {
    await page.goto('/recruit');
    await expect(page).toHaveURL(/\/register$/);
  });
});
