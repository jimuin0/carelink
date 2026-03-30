/**
 * @jest-environment node
 */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  bookingRateLimit: null,
  checkRateLimit: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('@/lib/email', () => ({
  sendBookingConfirmation: jest.fn(),
  sendNewBookingNotification: jest.fn(),
}));
jest.mock('@/lib/push', () => ({
  sendPushToFacilityOwners: jest.fn(),
  sendPushToUser: jest.fn(),
}));
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

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
});

const validBooking = {
  facility_id: '123e4567-e89b-12d3-a456-426614174000',
  staff_id: null,
  menu_id: null,
  coupon_id: null,
  booking_date: '2030-01-15',
  start_time: '10:00',
  end_time: '11:00',
  customer_name: 'テスト太郎',
  email: 'test@example.com',
  total_price: 5000,
  points_used: 0,
};

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/booking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Host: 'localhost' },
    body: JSON.stringify(body),
  });
}

function fluent(resolvedValue: unknown) {
  const self: Record<string, jest.Mock> = {};
  const handler = jest.fn(() => self);
  self.select = handler;
  self.insert = handler;
  self.eq = handler;
  self.not = handler;
  self.lt = handler;
  self.gt = handler;
  self.single = jest.fn(() => Promise.resolve(resolvedValue));
  return self;
}

describe('POST /api/booking', () => {
  test('正常に予約を作成する', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    // insert chain
    const insertChain = fluent({ data: { id: 'new-booking-1' }, error: null });
    // facility/menu/staff/owner lookups
    const lookupChain = fluent({ data: null });
    mockFrom.mockReturnValue(insertChain);
    // Override for email lookups (Promise.all of 4 queries)
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return insertChain;
      return lookupChain;
    });

    const res = await POST(makeRequest(validBooking));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.bookingId).toBe('new-booking-1');
  });

  test('バリデーション失敗→400', async () => {
    const res = await POST(makeRequest({ ...validBooking, customer_name: '' }));
    expect(res.status).toBe(400);
  });

  test('開始時間>=終了時間→400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(makeRequest({ ...validBooking, start_time: '11:00', end_time: '10:00' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('開始時間');
  });

  test('CSRF失敗→403', async () => {
    const { NextResponse } = jest.requireActual('next/server') as { NextResponse: typeof import('next/server').NextResponse };
    (checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({ error: 'CSRF' }, { status: 403 }));

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(403);
  });

  test('レートリミット→429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(429);
  });

  test('staff_id指定時の競合→409', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const staffId = '223e4567-e89b-12d3-a456-426614174000';
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [{ id: 'existing' }] }));
    mockFrom.mockReturnValue(conflictChain);

    const res = await POST(makeRequest({ ...validBooking, staff_id: staffId }));
    expect(res.status).toBe(409);
  });

  test('DB挿入失敗→500', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const insertChain = fluent({ data: null, error: { message: 'db error', code: '99999' } });
    mockFrom.mockReturnValue(insertChain);

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(500);
  });

  test('DB制約違反（23505）→409', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const insertChain = fluent({ data: null, error: { message: 'duplicate', code: '23505' } });
    mockFrom.mockReturnValue(insertChain);

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(409);
  });

  test('ポイント残高不足→400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    // user_points lookup
    const pointsChain = fluent(null);
    pointsChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 100 }] }));
    mockFrom.mockReturnValue(pointsChain);

    const res = await POST(makeRequest({ ...validBooking, points_used: 500 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('ポイント');
  });
});
