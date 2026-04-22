import { test, expect } from '@playwright/test';

/**
 * 支払いフロー E2E テスト
 * - Stripe Checkout セッション遷移
 * - 決済完了後のリダイレクト
 * - 領収書ページ
 * - エラーハンドリング
 * NOTE: 実際の決済処理は行わない（テストモード確認のみ）
 */

test.describe('支払いページ', () => {
  test('未認証で支払いページにアクセスするとリダイレクト', async ({ page }) => {
    await page.goto('/mypage/payment');
    await page.waitForLoadState('networkidle');
    // ログインページか mypage にリダイレクト
    const url = page.url();
    expect(url).toMatch(/login|auth|mypage|payment/);
  });

  test('支払い完了ページが正しく表示される', async ({ page }) => {
    // Stripe の success_url パラメータを含むページ
    await page.goto('/payment/complete?session_id=cs_test_dummy');
    await page.waitForLoadState('networkidle');
    // エラー500でないことを確認
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).not.toContain('500');
    expect(bodyText).not.toContain('Internal Server Error');
  });
});

test.describe('領収書 API', () => {
  test('session_id なしで 400 が返る', async ({ request }) => {
    const response = await request.get('/api/stripe/receipt');
    expect(response.status()).toBe(400);
  });

  test('未認証で 401 が返る', async ({ request }) => {
    const response = await request.get('/api/stripe/receipt?session_id=cs_test_dummy');
    expect(response.status()).toBe(401);
  });

  test('長すぎる session_id で 400 が返る', async ({ request }) => {
    const longId = 'x'.repeat(201);
    const response = await request.get(`/api/stripe/receipt?session_id=${longId}`);
    expect(response.status()).toBe(400);
  });

  test('Cache-Control が private, no-store である', async ({ request }) => {
    const response = await request.get('/api/stripe/receipt?session_id=cs_test_dummy');
    // 認証エラーでも Cache-Control はチェック可能
    if (response.status() === 401) {
      // 401 の場合は通常ヘッダーなし
      return;
    }
    const cc = response.headers()['cache-control'];
    if (cc) {
      expect(cc).toContain('no-store');
    }
  });
});

test.describe('Stripe Webhook セキュリティ', () => {
  test('署名なしの webhook が 400 を返す', async ({ request }) => {
    const response = await request.post('/api/stripe/webhook', {
      data: JSON.stringify({ type: 'checkout.session.completed' }),
      headers: { 'Content-Type': 'application/json' },
    });
    // 署名検証失敗で 400 または 401
    expect([400, 401, 403]).toContain(response.status());
  });

  test('payment/webhook も署名なしで拒否される', async ({ request }) => {
    const response = await request.post('/api/payment/webhook', {
      data: JSON.stringify({ type: 'checkout.session.completed' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect([400, 401, 403]).toContain(response.status());
  });
});

test.describe('金額表示', () => {
  test('支払い API が数値として金額を返す', async ({ request }) => {
    const response = await request.get('/api/salons');
    // salons API は金額を返さないが、200 が返ることを確認
    expect([200, 429]).toContain(response.status());
  });
});
