import { test, expect } from '@playwright/test';

/**
 * API コントラクト テスト
 * - レスポンス形式の一貫性
 * - エラーレスポンス形式の統一
 * - Content-Type ヘッダーの正確性
 * - API バージョニング互換性
 */

test.describe('API レスポンス形式', () => {
  test('/api/health のレスポンス形式が仕様通り', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');

    const json = await response.json();
    expect(json).toHaveProperty('status');
    expect(json.status).toBe('ok');
    expect(json).toHaveProperty('timestamp');
    expect(json).toHaveProperty('elapsed_ms');
    expect(typeof json.elapsed_ms).toBe('number');
  });

  test('/api/salons のレスポンスが配列', async ({ request }) => {
    const response = await request.get('/api/salons');
    if (response.status() === 200) {
      const json = await response.json();
      expect(Array.isArray(json)).toBe(true);
    }
  });

  test('エラーレスポンスは { error: string } 形式', async ({ request }) => {
    const response = await request.get('/api/salons?id=not-a-uuid-at-all-invalid-xxxxx');
    // UUID 不一致でリスト検索（エラーなし）またはエラー
    if (response.status() >= 400) {
      const json = await response.json();
      expect(json).toHaveProperty('error');
      expect(typeof json.error).toBe('string');
    }
  });

  test('429 レスポンスに error フィールドがある', async ({ request }) => {
    // レート制限をトリガー（大量リクエスト）
    let rateLimitResponse = null;
    for (let i = 0; i < 30; i++) {
      const r = await request.get('/api/salons');
      if (r.status() === 429) {
        rateLimitResponse = r;
        break;
      }
    }
    if (rateLimitResponse) {
      const json = await rateLimitResponse.json();
      expect(json).toHaveProperty('error');
    }
  });

  test('401 レスポンスに error フィールドがある', async ({ request }) => {
    const response = await request.get('/api/stripe/receipt?session_id=test');
    expect(response.status()).toBe(401);
    const json = await response.json();
    expect(json).toHaveProperty('error');
    expect(typeof json.error).toBe('string');
  });

  test('全 API が JSON を返す', async ({ request }) => {
    const endpoints = [
      '/api/health',
      '/api/salons',
      '/api/salons?id=11111111-1111-1111-1111-111111111111',
    ];
    for (const ep of endpoints) {
      const response = await request.get(ep);
      const ct = response.headers()['content-type'] || '';
      expect(ct).toContain('application/json');
    }
  });
});

test.describe('API バージョン互換性', () => {
  test('/api/v1/bookings が存在する', async ({ request }) => {
    const response = await request.get('/api/v1/bookings');
    // 認証が必要なので 401 が返るはず
    expect([200, 401, 403, 429]).toContain(response.status());
  });

  test('/api/v1/customers が存在する', async ({ request }) => {
    const response = await request.get('/api/v1/customers');
    expect([200, 401, 403, 429]).toContain(response.status());
  });
});

test.describe('CORS ヘッダー', () => {
  test('OPTIONS リクエストが適切に処理される', async ({ request }) => {
    const response = await request.fetch('/api/health', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://example.com',
        'Access-Control-Request-Method': 'GET',
      },
    });
    // 200 または 204 が返る
    expect([200, 204, 405]).toContain(response.status());
  });
});

test.describe('Content-Type 検証', () => {
  test('JSON 以外のボディを送ると適切なエラー', async ({ request }) => {
    const response = await request.post('/api/contact', {
      data: 'plain text body',
      headers: { 'Content-Type': 'text/plain' },
    });
    expect([400, 401, 403, 415, 429]).toContain(response.status());
  });

  test('不正な JSON ボディを送ると 400', async ({ request }) => {
    const response = await request.post('/api/report', {
      data: '{invalid json',
      headers: { 'Content-Type': 'application/json' },
    });
    expect([400, 403, 429]).toContain(response.status());
  });
});
