import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

/**
 * 並行予約・競合状態 E2E テスト
 * - 旧受付番号なしリクエストの作成前拒否（実予約競合は専用PG/browser runner）
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

  test('旧受付番号なし予約リクエストは作成前に拒否される', async ({ request }) => {
    const base=new URL(process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000');
    if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw new Error('legacy rejection proof requires loopback app');
    const ip='2001:db8:'+randomUUID().replace(/-/g,'').match(/.{1,4}/g)!.slice(0,6).join(':');
    const responses=await Promise.all(Array.from({length:10},()=>request.post('/api/booking',{data:{},headers:{Origin:base.origin,'x-real-ip':ip}})));
    expect(responses.every(response=>[428,429].includes(response.status()))).toBe(true);
    const rejected=responses.filter(response=>response.status()===428);expect(rejected.length).toBeGreaterThan(0);
    for(const response of rejected)expect((await response.json()).code).toBe('BOOKING_CREATE_KEY_REQUIRED');
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
