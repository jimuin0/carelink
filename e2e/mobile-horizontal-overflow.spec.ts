import { test, expect, type Page } from '@playwright/test';

/**
 * スマホ幅で公開ページが横にはみ出さないこと（2026年10月21日）。
 * 本番のトップは「都道府県から探す」「業種 × エリアで探す」の行が折り返さず、
 * 390px の画面で 494px まで横スクロールしていた。横スクロールを意図した行
 * （overflow-x の付いた業種ボタン列など）の中身は対象外にする。
 */
test.use({ viewport: { width: 375, height: 812 } });

async function overflowing(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const scrollsSideways = (e: Element) => {
      for (let p = e.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true;
      }
      return false;
    };
    const offenders = [...document.querySelectorAll('body *')]
      .filter(e => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && b.right > vw + 1 && getComputedStyle(e).position !== 'fixed' && !scrollsSideways(e);
      })
      .slice(0, 5)
      .map(e => `${e.tagName.toLowerCase()} "${(e.textContent ?? '').trim().slice(0, 20)}" right=${Math.round(e.getBoundingClientRect().right)}`);
    return { vw, scrollWidth: document.documentElement.scrollWidth, offenders };
  });
}

test('トップの下半分（都道府県・業種×エリア）がスマホ幅で横にはみ出さない', async ({ page }) => {
  await page.goto('/');
  const prefectures = page.getByRole('heading', { name: '都道府県から探す' });
  await prefectures.scrollIntoViewIfNeeded();
  await expect(prefectures).toBeVisible();
  await expect(page.getByRole('heading', { name: '業種 × エリアで探す' })).toBeVisible();
  const result = await overflowing(page);
  expect(result.offenders).toEqual([]);
  expect(result.scrollWidth).toBeLessThanOrEqual(result.vw);
});

for (const path of ['/search', '/register', '/auth/login', '/auth/signup']) {
  test(`${path} がスマホ幅で横にはみ出さない`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('main').first()).toBeVisible();
    const result = await overflowing(page);
    expect(result.offenders).toEqual([]);
    expect(result.scrollWidth).toBeLessThanOrEqual(result.vw);
  });
}
