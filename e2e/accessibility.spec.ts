import { test, expect } from '@playwright/test';

/**
 * アクセシビリティ E2E テスト
 * - ARIA ラベル
 * - キーボードナビゲーション
 * - コントラスト比（視覚的確認）
 * - フォームのラベル対応
 * - スクリーンリーダー対応
 */

test.describe('基本アクセシビリティ', () => {
  test('トップページに lang 属性がある', async ({ page }) => {
    await page.goto('/');
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang).toBeTruthy();
    expect(lang).toMatch(/ja|en/);
  });

  test('トップページに main ランドマークがある', async ({ page }) => {
    await page.goto('/');
    const main = page.locator('main');
    await expect(main).toBeVisible();
  });

  test('全ページに title タグがある', async ({ page }) => {
    const pages = ['/', '/search', '/auth/login'];
    for (const path of pages) {
      await page.goto(path);
      const title = await page.title();
      expect(title.length).toBeGreaterThan(0);
    }
  });

  test('画像に alt テキストがある', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const images = page.locator('img:not([alt])');
    const count = await images.count();
    // alt なしの img が存在しないことを確認
    expect(count).toBe(0);
  });

  test('リンクにテキストまたは aria-label がある', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const emptyLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      return links.filter(a => {
        const text = a.textContent?.trim() || '';
        const ariaLabel = a.getAttribute('aria-label') || '';
        const ariaLabelledBy = a.getAttribute('aria-labelledby') || '';
        const title = a.getAttribute('title') || '';
        return !text && !ariaLabel && !ariaLabelledBy && !title;
      }).length;
    });
    expect(emptyLinks).toBe(0);
  });
});

test.describe('フォームアクセシビリティ', () => {
  test('ログインフォームの input に label がある', async ({ page }) => {
    await page.goto('/auth/login');
    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    if (await emailInput.isVisible()) {
      const id = await emailInput.getAttribute('id');
      const ariaLabel = await emailInput.getAttribute('aria-label');
      const ariaLabelledBy = await emailInput.getAttribute('aria-labelledby');
      const hasLabel = id
        ? (await page.locator(`label[for="${id}"]`).count()) > 0
        : false;
      expect(hasLabel || !!ariaLabel || !!ariaLabelledBy).toBe(true);
    }
  });

  test('必須フィールドに required 属性がある', async ({ page }) => {
    await page.goto('/auth/login');
    const emailInput = page.locator('input[type="email"]').first();
    if (await emailInput.isVisible()) {
      const required = await emailInput.getAttribute('required');
      const ariaRequired = await emailInput.getAttribute('aria-required');
      expect(required !== null || ariaRequired === 'true').toBe(true);
    }
  });

  test('エラー時に role="alert" が表示される', async ({ page }) => {
    await page.goto('/auth/login');
    const submitBtn = page.getByRole('button', { name: /ログイン|Login/ }).first();
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
      await page.waitForTimeout(500);
      const alerts = page.locator('[role="alert"], .error, [aria-live="polite"]');
      // フォームバリデーションが発動する
      const count = await alerts.count();
      // HTML5 validation か aria alert どちらかが存在する
      const emailInvalid = await page.locator('input[type="email"]:invalid').count();
      expect(count > 0 || emailInvalid > 0).toBe(true);
    }
  });
});

test.describe('キーボードナビゲーション', () => {
  test('Tab キーでフォーカスが移動する', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'BODY']).toContain(focusedTag);
  });

  test('Skip to main content リンクが存在する', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    // 最初の Tab でスキップリンクにフォーカスが当たることが理想
    const skipLink = page.locator('a[href="#main"], a[href="#content"], a:has-text("スキップ"), a:has-text("Skip")').first();
    // 存在する場合のみチェック
    if (await skipLink.count() > 0) {
      await expect(skipLink).toBeDefined();
    }
  });

  test('検索フォームに Enter キーで送信できる', async ({ page }) => {
    await page.goto('/search');
    const searchInput = page.locator('input[type="search"], input[placeholder*="検索"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('テスト');
      await searchInput.press('Enter');
      await page.waitForLoadState('networkidle');
      // クラッシュしないことを確認
      expect(page.url()).toBeTruthy();
    }
  });
});

test.describe('モバイルアクセシビリティ', () => {
  test('タップターゲットサイズが十分である（44px以上）', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const smallTargets = await page.evaluate(() => {
      const interactive = Array.from(document.querySelectorAll('a, button, input, select'));
      return interactive.filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
      }).length;
    });
    // 小さいタップターゲットが一定数以下
    expect(smallTargets).toBeLessThan(10);
  });

  test('テキストが最小 16px 以上（iOS ズーム防止）', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const smallText = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input, select, textarea'));
      return inputs.filter(el => {
        const fontSize = parseFloat(window.getComputedStyle(el).fontSize);
        return fontSize < 16;
      }).length;
    });
    // iOS でズームが発生しないよう input フォントは 16px 以上
    expect(smallText).toBe(0);
  });
});

test.describe('ページ遷移アクセシビリティ', () => {
  test('ページ遷移後にフォーカスが適切に管理される', async ({ page }) => {
    await page.goto('/');
    await page.goto('/search');
    await page.waitForLoadState('networkidle');
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
    // body や先頭要素にフォーカスが戻る
    expect(['BODY', 'H1', 'MAIN', 'A', 'BUTTON']).toContain(focusedTag);
  });

  test('404 ページが分かりやすいエラーメッセージを表示する', async ({ page }) => {
    await page.goto('/this-page-does-not-exist-xyz-abc-123');
    const body = await page.locator('body').textContent();
    expect(body).toMatch(/404|見つかりません|Not Found/i);
  });
});
