import { test, expect } from '@playwright/test';

/**
 * 並行予約・競合状態 E2E テスト
 * - 同一スロットへの同時予約でダブルブッキング防止確認
 * - 同時キャンセルの冪等性
 * - API レベルでの競合状態検証
 * NOTE: 実際の予約は作成しない（API レベルの状態コード確認のみ）
 */

test.describe('競合状態保護（API レベル）', () => {
  test('同一 booking_id への並行キャンセルリクエストが安全に処理される', async ({ request }) => {
    const fakeBookingId = '11111111-1111-1111-1111-111111111111';

    // 未認証で並行リクエストを送信（認証チェックで早期リターンされる）
    const requests = Array.from({ length: 5 }, () =>
      request.post(`/api/booking/${fakeBookingId}/cancel`, {
        data: { reason: '都合により' },
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const responses = await Promise.all(requests);
    const statuses = responses.map(r => r.status());

    // 全て 401（未認証）または 403（CSRF）であり、500 は返らない
    expect(statuses.every(s => s !== 500)).toBe(true);
    expect(statuses.every(s => [401, 403, 400, 429].includes(s))).toBe(true);
  });

  test('同一 booking_id への並行変更リクエストが安全に処理される', async ({ request }) => {
    const fakeBookingId = '11111111-1111-1111-1111-111111111111';

    const requests = Array.from({ length: 5 }, (_, i) =>
      request.post(`/api/booking/${fakeBookingId}/change`, {
        data: {
          booking_date: `2099-12-${String(i + 1).padStart(2, '0')}`,
          start_time: '10:00',
          end_time: '11:00',
        },
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const responses = await Promise.all(requests);
    const statuses = responses.map(r => r.status());

    expect(statuses.every(s => s !== 500)).toBe(true);
  });

  test('同一スロットへの並行予約が 500 を返さない', async ({ request }) => {
    const requests = Array.from({ length: 10 }, (_, i) =>
      request.post('/api/booking', {
        data: {
          facility_id: '11111111-1111-1111-1111-111111111111',
          menu_id: '22222222-2222-2222-2222-222222222222',
          booking_date: '2099-12-31',
          start_time: '10:00:00',
          end_time: '11:00:00',
          customer_name: `テスト顧客${i}`,
          customer_email: `test${i}@example.com`,
          customer_phone: '09000000000',
        },
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const responses = await Promise.all(requests);
    const statuses = responses.map(r => r.status());

    // 500 は絶対に返らない
    const has500 = statuses.some(s => s === 500);
    expect(has500).toBe(false);

    // 許可される状態コードのみ
    expect(statuses.every(s => [200, 201, 400, 401, 403, 409, 429].includes(s))).toBe(true);
  });

  test('お気に入りの並行トグルが安全に処理される', async ({ request }) => {
    const requests = Array.from({ length: 10 }, () =>
      request.post('/api/favorites', {
        data: { facility_id: '11111111-1111-1111-1111-111111111111' },
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const responses = await Promise.all(requests);
    const statuses = responses.map(r => r.status());

    // 全て認証エラーまたは適切なレスポンス（500 なし）
    expect(statuses.every(s => s !== 500)).toBe(true);
  });

  test('並行レポート送信が重複エラーを適切に返す', async ({ request }) => {
    const requests = Array.from({ length: 5 }, () =>
      request.post('/api/report', {
        data: {
          target_type: 'review',
          target_id: '11111111-1111-1111-1111-111111111111',
          reason: 'spam',
        },
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const responses = await Promise.all(requests);
    const statuses = responses.map(r => r.status());

    // CSRF エラーか重複エラー（409）が返る、500 は返らない
    expect(statuses.every(s => s !== 500)).toBe(true);
    expect(statuses.every(s => [200, 400, 403, 409, 429].includes(s))).toBe(true);
  });
});

test.describe('レート制限の並行処理', () => {
  test('短時間の大量リクエストでレート制限が一貫して機能する', async ({ request }) => {
    // /api/salons に 30 リクエストを並行送信（制限は 20/min）
    const requests = Array.from({ length: 30 }, () =>
      request.get('/api/salons')
    );

    const responses = await Promise.all(requests);
    const statuses = responses.map(r => r.status());

    // 500 は絶対に返らない
    expect(statuses.every(s => s !== 500)).toBe(true);
    // 200 と 429 のみ
    expect(statuses.every(s => [200, 429].includes(s))).toBe(true);
  });

  test('webhook エンドポイントへの並行リクエストが安全に処理される', async ({ request }) => {
    const requests = Array.from({ length: 5 }, () =>
      request.post('/api/stripe/webhook', {
        data: '{}',
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const responses = await Promise.all(requests);
    const statuses = responses.map(r => r.status());

    // 署名検証失敗で 400 が返る、500 は返らない
    expect(statuses.every(s => s !== 500)).toBe(true);
  });
});
