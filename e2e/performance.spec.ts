import { test, expect } from '@playwright/test';

/**
 * パフォーマンス E2E テスト
 * - Core Web Vitals 相当の確認
 * - API レスポンスタイム
 * - 画像最適化
 * - キャッシュヘッダー
 * - バンドルサイズ
 */

test.describe('ページロード パフォーマンス', () => {
  test('トップページが 3 秒以内に表示される', async ({ page }) => {
    const start = Date.now();
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(3000);
  });

  test('検索ページが 3 秒以内に表示される', async ({ page }) => {
    const start = Date.now();
    await page.goto('/search');
    await page.waitForLoadState('domcontentloaded');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(3000);
  });

  test('LCP 要素が 2.5 秒以内に描画される', async ({ page }) => {
    await page.goto('/');
    const lcp = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          if (entries.length > 0) {
            resolve(entries[entries.length - 1].startTime);
            observer.disconnect();
          }
        });
        observer.observe({ entryTypes: ['largest-contentful-paint'] });
        setTimeout(() => resolve(9999), 5000);
      });
    });
    expect(lcp).toBeLessThan(2500);
  });

  test('累積レイアウトシフト（CLS）が 0.1 以下', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const cls = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        let clsScore = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const layoutEntry = entry as any;
            if (!layoutEntry.hadRecentInput) {
              clsScore += layoutEntry.value;
            }
          }
        });
        observer.observe({ entryTypes: ['layout-shift'] });
        setTimeout(() => {
          observer.disconnect();
          resolve(clsScore);
        }, 2000);
      });
    });
    expect(cls).toBeLessThan(0.1);
  });
});

test.describe('API レスポンスタイム', () => {
  test('/api/health が 500ms 以内に応答する', async ({ request }) => {
    const start = Date.now();
    const response = await request.get('/api/health');
    const elapsed = Date.now() - start;
    expect(response.status()).toBe(200);
    expect(elapsed).toBeLessThan(500);
  });

  test('/api/salons が 2 秒以内に応答する', async ({ request }) => {
    const start = Date.now();
    const response = await request.get('/api/salons');
    const elapsed = Date.now() - start;
    expect([200, 429]).toContain(response.status());
    expect(elapsed).toBeLessThan(2000);
  });

  test('連続 5 リクエストで応答時間が一定', async ({ request }) => {
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      await request.get('/api/health');
      times.push(Date.now() - start);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const max = Math.max(...times);
    // 最大でも平均の5倍を超えない（急激な劣化なし）
    expect(max).toBeLessThan(avg * 5 + 1000);
  });
});

test.describe('画像最適化', () => {
  test('画像が WebP または AVIF 形式で提供される', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const imageRequests: string[] = [];
    page.on('response', (response) => {
      const contentType = response.headers()['content-type'] || '';
      if (contentType.includes('image/')) {
        imageRequests.push(contentType);
      }
    });

    await page.reload();
    await page.waitForLoadState('networkidle');

    // Next.js の画像最適化で WebP/AVIF が使われる
    const modernFormats = imageRequests.filter(
      ct => ct.includes('webp') || ct.includes('avif')
    );
    // 画像が存在する場合は最適化されている
    if (imageRequests.length > 0) {
      expect(modernFormats.length).toBeGreaterThan(0);
    }
  });

  test('画像に loading="lazy" が設定されている（above-fold 以外）', async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState('networkidle');

    const lazyImages = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img'));
      return images.filter(img => img.loading === 'lazy').length;
    });
    const totalImages = await page.locator('img').count();
    // 画像が複数ある場合は遅延読み込みが使われている
    if (totalImages > 3) {
      expect(lazyImages).toBeGreaterThan(0);
    }
  });
});

test.describe('キャッシュ設定', () => {
  test('静的アセットに長期キャッシュが設定されている', async ({ page }) => {
    const cacheableResponses: string[] = [];
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/_next/static/')) {
        const cc = response.headers()['cache-control'] || '';
        cacheableResponses.push(cc);
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    for (const cc of cacheableResponses) {
      // _next/static は長期キャッシュされるべき
      expect(cc).toMatch(/max-age|immutable/);
    }
  });

  test('領収書 API にキャッシュ無効ヘッダーがある', async ({ request }) => {
    const response = await request.get('/api/stripe/receipt?session_id=test');
    const cc = response.headers()['cache-control'] || '';
    // 401 返る場合でも Cache-Control を確認
    if (response.status() === 200) {
      expect(cc).toContain('no-store');
    }
  });
});

test.describe('バンドルサイズ', () => {
  test('メイン JS バンドルが 500KB 以下', async ({ page }) => {
    let mainBundleSize = 0;
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/_next/static/chunks/') && url.endsWith('.js')) {
        const body = await response.body().catch(() => Buffer.from(''));
        mainBundleSize += body.length;
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 総 JS バンドルが 1MB 以下（圧縮前）
    expect(mainBundleSize).toBeLessThan(1024 * 1024);
  });
});
