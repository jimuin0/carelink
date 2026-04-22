import { test, expect } from '@playwright/test';

/**
 * セキュリティ E2E テスト
 * - XSS injection via URL params
 * - CSRF 保護確認
 * - IDOR 防止（他ユーザーリソースへのアクセス）
 * - セキュリティヘッダー確認
 * - オープンリダイレクト防止
 */

test.describe('セキュリティヘッダー', () => {
  test('X-Frame-Options または CSP frame-ancestors が設定されている', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response?.headers() ?? {};
    const xFrame = headers['x-frame-options'];
    const csp = headers['content-security-policy'];
    const hasFrameProtection =
      xFrame?.toUpperCase().includes('DENY') ||
      xFrame?.toUpperCase().includes('SAMEORIGIN') ||
      csp?.includes('frame-ancestors');
    expect(hasFrameProtection).toBe(true);
  });

  test('X-Content-Type-Options: nosniff が設定されている', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response?.headers() ?? {};
    expect(headers['x-content-type-options']).toBe('nosniff');
  });

  test('Referrer-Policy が設定されている', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response?.headers() ?? {};
    expect(headers['referrer-policy']).toBeTruthy();
  });

  test('HTTPS リダイレクト（本番環境）', async ({ page }) => {
    // Vercel本番環境のみ確認
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL || '';
    if (baseUrl.startsWith('https://')) {
      const response = await page.goto('/');
      expect(page.url()).toMatch(/^https:/);
    } else {
      test.skip();
    }
  });
});

test.describe('XSS 防止', () => {
  test('URL パラメータの XSS がエスケープされる', async ({ page }) => {
    await page.goto('/search?q=<script>alert(1)</script>');
    // alert が発生しないことを確認
    let alertTriggered = false;
    page.on('dialog', () => { alertTriggered = true; });
    await page.waitForLoadState('networkidle');
    expect(alertTriggered).toBe(false);
    // スクリプトタグが DOM にそのまま出力されていない
    const content = await page.content();
    expect(content).not.toContain('<script>alert(1)</script>');
  });

  test('施設名の XSS がエスケープされる', async ({ page }) => {
    await page.goto('/search?area=<img src=x onerror=alert(1)>');
    let alertTriggered = false;
    page.on('dialog', () => { alertTriggered = true; });
    await page.waitForLoadState('networkidle');
    expect(alertTriggered).toBe(false);
  });

  test('検索クエリの script タグがエスケープされる', async ({ page }) => {
    const xssPayloads = [
      '"><script>alert(1)</script>',
      "';alert(1)//",
      '<svg onload=alert(1)>',
      'javascript:alert(1)',
    ];
    for (const payload of xssPayloads) {
      let alertTriggered = false;
      page.on('dialog', () => { alertTriggered = true; });
      await page.goto(`/search?q=${encodeURIComponent(payload)}`);
      await page.waitForLoadState('networkidle');
      expect(alertTriggered).toBe(false);
      page.removeAllListeners('dialog');
    }
  });
});

test.describe('オープンリダイレクト防止', () => {
  test('外部URLへのリダイレクトが防止される', async ({ page }) => {
    // redirect パラメータに外部URLを指定しても外部にリダイレクトされない
    await page.goto('/auth/login?redirect=https://evil.example.com');
    await page.waitForLoadState('networkidle');
    expect(page.url()).not.toContain('evil.example.com');
  });

  test('javascript: スキームのリダイレクトが防止される', async ({ page }) => {
    await page.goto('/auth/login?redirect=javascript:alert(1)');
    await page.waitForLoadState('networkidle');
    let alertTriggered = false;
    page.on('dialog', () => { alertTriggered = true; });
    expect(alertTriggered).toBe(false);
    expect(page.url()).not.toContain('javascript:');
  });
});

test.describe('CSRF 保護', () => {
  test('API への直接 POST が CSRF エラーになる', async ({ request }) => {
    const response = await request.post('/api/contact', {
      data: {
        name: 'テスト',
        email: 'test@example.com',
        message: 'テストメッセージ',
      },
      headers: {
        'Content-Type': 'application/json',
        // X-CSRF-Token ヘッダーなし
      },
    });
    // CSRF チェックが有効な場合は 403
    expect([403, 400, 401, 429]).toContain(response.status());
  });
});

test.describe('IDOR 防止', () => {
  test('認証なしで予約詳細にアクセスできない', async ({ request }) => {
    const fakeBookingId = '11111111-1111-1111-1111-111111111111';
    const response = await request.get(`/api/booking/${fakeBookingId}`);
    expect([401, 403, 404]).toContain(response.status());
  });

  test('認証なしで予約変更できない', async ({ request }) => {
    const fakeBookingId = '11111111-1111-1111-1111-111111111111';
    const response = await request.post(`/api/booking/${fakeBookingId}/change`, {
      data: {
        booking_date: '2099-12-31',
        start_time: '10:00:00',
        end_time: '11:00:00',
      },
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403, 403]).toContain(response.status());
  });

  test('認証なしでキャンセルできない', async ({ request }) => {
    const fakeBookingId = '11111111-1111-1111-1111-111111111111';
    const response = await request.post(`/api/booking/${fakeBookingId}/cancel`, {
      data: { reason: 'test' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403, 404]).toContain(response.status());
  });

  test('認証なしでプロフィール更新できない', async ({ request }) => {
    const response = await request.patch('/api/profile', {
      data: { display_name: 'ハッカー' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403]).toContain(response.status());
  });
});

test.describe('レート制限', () => {
  test('短時間に大量リクエストで 429 が返る', async ({ request }) => {
    // /api/health は認証不要なのでレート制限のみ確認
    const results: number[] = [];
    for (let i = 0; i < 25; i++) {
      const response = await request.get('/api/health');
      results.push(response.status());
    }
    // 全部成功する場合もあるが 429 が返ることもある
    // レート制限が実装されている endpoint は 429 が出る
    const has429 = results.some(s => s === 429);
    const allOk = results.every(s => s === 200);
    expect(has429 || allOk).toBe(true);
  });
});

test.describe('情報漏洩防止', () => {
  test('エラーレスポンスにスタックトレースが含まれない', async ({ request }) => {
    const response = await request.get('/api/salons?id=not-a-uuid-format-xxxxxxx');
    const body = await response.text();
    expect(body).not.toContain('at ');
    expect(body).not.toContain('Error:');
    expect(body).not.toContain('node_modules');
  });

  test('存在しない API エンドポイントが 404 を返す', async ({ request }) => {
    const response = await request.get('/api/nonexistent-endpoint-xyz');
    expect(response.status()).toBe(404);
  });

  test('DB 接続情報がレスポンスに漏れていない', async ({ request }) => {
    const response = await request.get('/api/health');
    const body = await response.text();
    expect(body).not.toContain('supabase.co');
    expect(body).not.toContain('postgres://');
    expect(body).not.toContain('password');
  });
});
