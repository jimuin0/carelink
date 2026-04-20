/**
 * @jest-environment node
 *
 * Tests for POST/DELETE /api/google-calendar/sync
 * Key assertions:
 *   - DELETE: booking_calendar_events delete failure → 500 (calendar event
 *     removed from Google but DB record remains — inconsistent state flagged)
 *   - POST: booking ownership guard prevents other users from syncing
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const BOOKING_UUID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const GOOGLE_EVENT_ID = 'gcal_event_abc123';

const mockFrom = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockFrom }),
}));

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

import { NextRequest } from 'next/server';
import { POST, DELETE } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeDeleteRequest(bookingId?: string) {
  const url = new URL('http://localhost/api/google-calendar/sync');
  if (bookingId) url.searchParams.set('bookingId', bookingId);
  return new NextRequest(url.toString(), { method: 'DELETE' });
}

function makePostReq(body: object) {
  return new NextRequest('http://localhost/api/google-calendar/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function singleChain(data: unknown, error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error })),
  };
}

function upsertChain(error: unknown = null) {
  return { upsert: jest.fn(() => Promise.resolve({ error })) };
}

const FUTURE_DATE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

const BOOKING_DATA = {
  id: BOOKING_UUID,
  user_id: USER_ID,
  booking_date: '2026-12-01',
  start_time: '10:00:00',
  duration_minutes: 60,
  facility_profiles: { name: 'テスト施設', address: '東京都' },
  menus: { name: 'テストメニュー' },
};

const TOKEN_ROW = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expires_at: FUTURE_DATE,
};

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── POST: security guards ────────────────────────────────────────────────────

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makePostReq({ bookingId: BOOKING_UUID }));
  expect(res.status).toBe(401);
});

test('POST: bookingId なし → 400', async () => {
  const res = await POST(makePostReq({}));
  expect(res.status).toBe(400);
});

test('POST: 不正なUUID → 400', async () => {
  const res = await POST(makePostReq({ bookingId: 'not-uuid' }));
  expect(res.status).toBe(400);
});

test('POST: 他ユーザーの予約 → 404 (IDOR防止)', async () => {
  // booking not found (ownership check via eq user_id)
  mockFrom.mockReturnValue(singleChain(null));
  const res = await POST(makePostReq({ bookingId: BOOKING_UUID }));
  expect(res.status).toBe(404);
});

test('POST: Google Calendar未接続 → 400', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(BOOKING_DATA); // booking found
    return singleChain(null); // no token
  });
  const res = await POST(makePostReq({ bookingId: BOOKING_UUID }));
  expect(res.status).toBe(400);
});

test('POST: 正常同期（新規イベント作成） → 200', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(BOOKING_DATA); // booking
    if (callNum === 2) return singleChain(TOKEN_ROW); // token
    if (callNum === 3) return singleChain(null); // no existing calendar event
    return { upsert: jest.fn(() => Promise.resolve({ error: null })) };
  });
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ id: GOOGLE_EVENT_ID }),
  });

  const res = await POST(makePostReq({ bookingId: BOOKING_UUID }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
  expect(json.googleEventId).toBe(GOOGLE_EVENT_ID);
});

// ─── DELETE: security guards ──────────────────────────────────────────────────

test('DELETE: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await DELETE(makeDeleteRequest());
  expect(res.status).toBe(401);
});

test('DELETE: bookingId なし → 400', async () => {
  const res = await DELETE(makeDeleteRequest());
  expect(res.status).toBe(400);
});

// ─── DELETE: critical DB failure ─────────────────────────────────────────────

test('DELETE: カレンダーイベントレコード削除失敗 → 500', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ google_event_id: GOOGLE_EVENT_ID }); // cal event
    if (callNum === 2) return singleChain(null); // no token (skip Google API call)
    // delete call
    return {
      delete: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn(() => Promise.resolve({ error: { message: 'DB delete failed' } })),
        }),
      }),
    };
  });
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

  const res = await DELETE(makeDeleteRequest(BOOKING_UUID));
  expect(res.status).toBe(500);
});

test('DELETE: カレンダーイベントなし → 200 ok:true (ノーオペ)', async () => {
  mockFrom.mockReturnValue(singleChain(null)); // no cal event record
  const res = await DELETE(makeDeleteRequest(BOOKING_UUID));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('DELETE: 正常削除 → 200 ok:true', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ google_event_id: GOOGLE_EVENT_ID }); // cal event
    if (callNum === 2) return singleChain(TOKEN_ROW); // token
    // delete call
    return {
      delete: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn(() => Promise.resolve({ error: null })),
        }),
      }),
    };
  });
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

  const res = await DELETE(makeDeleteRequest(BOOKING_UUID));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});
