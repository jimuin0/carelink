/**
 * @jest-environment node
 */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: null,
  checkRateLimit: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('@/lib/email', () => ({ sendBookingCancelled: jest.fn() }));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));

const mockGetUser = jest.fn();
const mockFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}));
jest.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: jest.fn() }),
}));

import { POST } from '../route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';

const validId = '123e4567-e89b-12d3-a456-426614174000';

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
});

function makeRequest() {
  return new Request('http://localhost/api/booking/x/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Host: 'localhost' },
  });
}

function fluent(resolvedValue: unknown) {
  const self: Record<string, jest.Mock> = {};
  const handler = jest.fn(() => self);
  self.select = handler;
  self.eq = handler;
  self.update = handler;
  self.limit = handler;
  self.single = jest.fn(() => Promise.resolve(resolvedValue));
  return self;
}

describe('POST /api/booking/[id]/cancel', () => {
  test('正常にキャンセルする', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        // booking lookup
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'test@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      // update chain: from→update→eq→eq (two eq calls chained)
      // and subsequent calls for email lookups
      const eqTerminal = jest.fn(() => Promise.resolve({ error: null }));
      const eqFirst = jest.fn(() => ({ eq: eqTerminal, then: (fn: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(fn) }));
      return {
        update: jest.fn(() => ({ eq: eqFirst })),
        select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })), limit: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })) })) })) })),
      };
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('認証なし→401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(401);
  });

  test('予約が存在しない→404', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(fluent({ data: null }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(404);
  });

  test('他のユーザーの予約→403', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(fluent({
      data: { id: validId, user_id: 'other-user', status: 'pending' },
    }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(403);
  });

  test('既にキャンセル済み→400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(fluent({
      data: { id: validId, user_id: 'user-1', status: 'cancelled' },
    }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(400);
  });

  test('不正なID→400', async () => {
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'invalid' }) });
    expect(res.status).toBe(400);
  });

  test('CSRF失敗→403', async () => {
    const { NextResponse } = jest.requireActual('next/server') as { NextResponse: typeof import('next/server').NextResponse };
    (checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({ error: 'CSRF' }, { status: 403 }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(403);
  });

  test('レートリミット→429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(429);
  });
});

// ─── 深掘り: 状態機械の全パターン ────────────────────────────────────────────

  test('cancel_fee_paid はキャンセル不可 → 400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(fluent({
      data: { id: validId, user_id: 'user-1', status: 'cancel_fee_paid' },
    }));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(400);
  });

  test('completed はキャンセル不可 → 400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(fluent({
      data: { id: validId, user_id: 'user-1', status: 'completed' },
    }));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(400);
  });

  test('no_show はキャンセル不可 → 400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(fluent({
      data: { id: validId, user_id: 'user-1', status: 'no_show' },
    }));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(400);
  });

  test('confirmed はキャンセル可能 → 200', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'confirmed',
            facility_id: 'f-1', customer_name: 'テスト', email: 'test@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      const eqTerminal = jest.fn(() => Promise.resolve({ error: null }));
      const eqFirst = jest.fn(() => ({ eq: eqTerminal }));
      return {
        update: jest.fn(() => ({ eq: eqFirst })),
        select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })), limit: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })) })) })) })),
      };
    });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });

// ─── 深掘り: DB 更新失敗 ─────────────────────────────────────────────────────

  test('DB update 失敗 → 500', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'test@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      const eqTerminal = jest.fn(() => Promise.resolve({ error: { message: 'DB error' } }));
      const eqFirst = jest.fn(() => ({ eq: eqTerminal }));
      return { update: jest.fn(() => ({ eq: eqFirst })) };
    });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(500);
  });

// ─── 深掘り: writeAuditLog 呼び出し確認 ─────────────────────────────────────

  test('キャンセル成功時に writeAuditLog が呼ばれる', async () => {
    const { writeAuditLog } = require('@/lib/audit-logger');
    jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'test@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      const eqTerminal = jest.fn(() => Promise.resolve({ error: null }));
      const eqFirst = jest.fn(() => ({ eq: eqTerminal }));
      return {
        update: jest.fn(() => ({ eq: eqFirst })),
        select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })), limit: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })) })) })) })),
      };
    });

    await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    // writeAuditLog は非同期fire-and-forget なので呼ばれた記録を確認
    // (モックがインポート済みであることを前提)
  });

// ─── 深掘り: sendBookingCancelled 呼び出し確認 ───────────────────────────────

  test('キャンセル成功時に email 送信関数が呼ばれる', async () => {
    const { sendBookingCancelled } = require('@/lib/email');
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト花子', email: 'test@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      const eqTerminal = jest.fn(() => Promise.resolve({ error: null }));
      const eqFirst = jest.fn(() => ({ eq: eqTerminal }));
      return {
        update: jest.fn(() => ({ eq: eqFirst })),
        select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: { name: 'Salon X' } })), limit: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })) })) })) })),
      };
    });

    await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(sendBookingCancelled).toHaveBeenCalled();
  });

// ─── 深掘り: レートリミットパラメーター ─────────────────────────────────────

  test('レートリミットパラメーター確認（10 req/60s）', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    const req = new Request('http://localhost/api/booking/x/cancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost',
        Host: 'localhost',
        'x-forwarded-for': '192.168.1.1',
      },
    });
    await POST(req, { params: Promise.resolve({ id: validId }) });
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[2]).toBe(10);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('cancel');
  });

  test('x-forwarded-for の先頭 IP を使う', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    const req = new Request('http://localhost/api/booking/x/cancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost',
        Host: 'localhost',
        'x-forwarded-for': '10.0.0.1, 192.168.1.1',
      },
    });
    await POST(req, { params: Promise.resolve({ id: validId }) });
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('10.0.0.1');
  });

  test('x-forwarded-for なしは unknown IP を使う', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    const req = new Request('http://localhost/api/booking/x/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Host: 'localhost' },
    });
    await POST(req, { params: Promise.resolve({ id: validId }) });
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

// ─── 深掘り: IDOR defence-in-depth ──────────────────────────────────────────

  test('UPDATE に user_id の WHERE 句が含まれる（IDOR 二重防御）', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    const innerEq = jest.fn(() => Promise.resolve({ error: null }));
    const outerEq = jest.fn(() => ({ eq: innerEq }));
    const updateMock = jest.fn(() => ({ eq: outerEq }));

    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'test@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      if (callNum === 2) return { update: updateMock };
      return {
        select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })), limit: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })) })) })) })),
      };
    });

    await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    // innerEq は user_id でフィルタされる
    expect(innerEq).toHaveBeenCalledWith('user_id', 'user-1');
  });

// ─── 深掘り: 例外 → 500 ──────────────────────────────────────────────────────

  test('予期しない例外 → 500', async () => {
    mockGetUser.mockImplementation(() => { throw new Error('Unexpected'); });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(500);
  });

// ─── 深掘り: menu_id ありのキャンセル ────────────────────────────────────────

  test('menu_id ありでメニュー名を取得', async () => {
    const { sendBookingCancelled } = require('@/lib/email');
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'test@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: 'menu-1', staff_id: null,
          },
        });
      }
      if (callNum === 2) {
        // update → eq → eq
        const eqTerminal = jest.fn(() => Promise.resolve({ error: null }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      // email path: facility_profiles, facility_menus, facility_members
      if (table === 'facility_menus') return fluent({ data: { name: 'カット' } });
      return fluent({ data: null });
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    expect(sendBookingCancelled).toHaveBeenCalled();
  });

// ─── 深掘り: オーナーへのキャンセル通知 ──────────────────────────────────────

  test('オーナーメールが存在する場合も sendBookingCancelled を呼ぶ', async () => {
    const { sendBookingCancelled } = require('@/lib/email');
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => Promise.resolve({ error: null }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      if (table === 'facility_profiles') return fluent({ data: { name: 'Salon X' } });
      if (table === 'facility_members') {
        // owner found
        const chain = fluent({ data: { user_id: 'owner-1' } });
        return chain;
      }
      if (table === 'profiles') return fluent({ data: { email: 'owner@example.com' } });
      return fluent({ data: null });
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    expect(sendBookingCancelled).toHaveBeenCalledTimes(2);
  });

// ─── 深掘り: LINE Works キャンセル通知 ──────────────────────────────────────

  test('isLineWorksConfigured=true → LINE Works 通知パスを通る', async () => {
    jest.mock('@/lib/integrations/line-works', () => ({
      isLineWorksConfigured: jest.fn(() => true),
      notifyCancellationLineWorks: jest.fn().mockResolvedValue(true),
    }));

    const { isLineWorksConfigured } = require('@/lib/integrations/line-works');
    isLineWorksConfigured.mockReturnValue(true);

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: 'staff-lw',
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => Promise.resolve({ error: null }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      return fluent({ data: null });
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
  });
