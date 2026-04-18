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
