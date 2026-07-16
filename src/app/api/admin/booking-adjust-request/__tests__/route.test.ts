/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/booking-adjust-request（時間調整依頼の送信）
 * Key assertions:
 *   - email: 無料で送信可能 / line: time_adjust_line 購入が必要（403）
 *   - 他施設の予約 → 404（IDOR/列挙防止）
 *   - 終了/キャンセル済み予約 → 400
 *   - LINE 未連携 → 400、LINE 送信失敗 → 502
 */

jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: {},
  checkRateLimit: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('@/lib/supabase-server-auth');
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('@/lib/email');
jest.mock('@/lib/line');
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });

import { POST } from '../route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-logger';

const BOOKING_UUID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '33333333-3333-3333-3333-333333333333';

type Booking = {
  id: string; facility_id: string; user_id: string | null;
  customer_name: string; email: string | null;
  booking_date: string; start_time: string; end_time: string; status: string;
};

function bookingRow(over: Partial<Booking> = {}): Booking {
  return {
    id: BOOKING_UUID, facility_id: 'fac-1', user_id: 'cust-1',
    customer_name: '顧客 太郎', email: 'customer@example.com',
    booking_date: '2026-07-01', start_time: '10:00', end_time: '11:00', status: 'confirmed',
    ...over,
  };
}

let cfg: {
  booking: Booking | null;
  membership: { facility_id: string; role: string } | null;
  facility: { name: string } | null;
  entitlements: { facility_id: string; option_key: string }[];
  lineLink: { line_user_id: string } | null;
};

let mockSendEmail: jest.Mock;
let mockSendLineText: jest.Mock;

function setup() {
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);

  cfg = {
    booking: bookingRow(),
    membership: { facility_id: 'fac-1', role: 'owner' },
    facility: { name: 'テストサロン' },
    entitlements: [],
    lineLink: { line_user_id: 'LINE-1' },
  };

  const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');
  createServerSupabaseAuthClient.mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }) },
  });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'bookings') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: cfg.booking }),
            }),
          }),
        };
      }
      if (table === 'facility_members') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                in: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn().mockResolvedValue({ data: cfg.membership }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'facility_profiles') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: cfg.facility }),
            }),
          }),
        };
      }
      if (table === 'facility_entitlements') {
        return {
          select: jest.fn().mockReturnValue({
            in: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: cfg.entitlements, error: null }),
            }),
          }),
        };
      }
      if (table === 'line_user_links') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: cfg.lineLink }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  });

  const emailModule = require('@/lib/email');
  // sendTimeAdjustRequest は送信成否を boolean で返す契約（route 側はこれを見て 502 を判定する）。
  mockSendEmail = jest.fn().mockResolvedValue(true);
  emailModule.sendTimeAdjustRequest = mockSendEmail;

  const lineModule = require('@/lib/line');
  mockSendLineText = jest.fn().mockResolvedValue(true);
  lineModule.sendLineText = mockSendLineText;
}

beforeEach(() => {
  jest.clearAllMocks();
  setup();
});

function makeRequest(body: object = { bookingId: BOOKING_UUID, channel: 'email' }) {
  return new Request('http://localhost/api/admin/booking-adjust-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('CSRF 失敗 → その応答を返す', async () => {
  (checkCsrf as jest.Mock).mockReturnValue(new Response('csrf', { status: 403 }));
  const res = await POST(makeRequest());
  expect(res.status).toBe(403);
});

test('レートリミット超過 → 429', async () => {
  (checkRateLimit as jest.Mock).mockResolvedValue(true);
  const res = await POST(makeRequest());
  expect(res.status).toBe(429);
});

test('bookingId 不正 → 400', async () => {
  const res = await POST(makeRequest({ bookingId: 'bad', channel: 'email' }));
  expect(res.status).toBe(400);
});

test('channel 不正 → 400', async () => {
  const res = await POST(makeRequest({ bookingId: BOOKING_UUID, channel: 'sms' }));
  expect(res.status).toBe(400);
});

test('body が JSON でない → 400', async () => {
  const req = new Request('http://localhost/api/admin/booking-adjust-request', { method: 'POST', body: 'x' });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

test('未認証 → 401', async () => {
  const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');
  createServerSupabaseAuthClient.mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
  });
  const res = await POST(makeRequest());
  expect(res.status).toBe(401);
});

test('予約が存在しない → 404', async () => {
  cfg.booking = null;
  const res = await POST(makeRequest());
  expect(res.status).toBe(404);
});

test('他施設の予約（membership なし）→ 404（列挙防止）', async () => {
  cfg.membership = null;
  const res = await POST(makeRequest());
  expect(res.status).toBe(404);
});

test('キャンセル済み予約 → 400（誤送信防止）', async () => {
  cfg.booking = bookingRow({ status: 'cancelled' });
  const res = await POST(makeRequest());
  expect(res.status).toBe(400);
});

test('pending 予約には送信できる', async () => {
  cfg.booking = bookingRow({ status: 'pending' });
  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
});

test('email: メールアドレスなし → 400', async () => {
  cfg.booking = bookingRow({ email: null });
  const res = await POST(makeRequest());
  expect(res.status).toBe(400);
});

test('email 正常系: 無料で送信・監査ログ記録', async () => {
  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
  expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({
    customerEmail: 'customer@example.com',
    facilityName: 'テストサロン',
    bookingDate: '2026-07-01',
  }));
  expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
    action: 'booking_adjust_request',
    newValues: { channel: 'email' },
  }));
});

test('email: 施設名が引けない場合は空文字', async () => {
  cfg.facility = null;
  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
  expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ facilityName: '' }));
});

test('email: 送信失敗（sendTimeAdjustRequest が false を返す）→ 502', async () => {
  mockSendEmail.mockResolvedValue(false);
  const res = await POST(makeRequest());
  expect(res.status).toBe(502);
});

test('line: オプション未購入 → 403（有料ゲート）', async () => {
  const res = await POST(makeRequest({ bookingId: BOOKING_UUID, channel: 'line' }));
  expect(res.status).toBe(403);
  expect(mockSendLineText).not.toHaveBeenCalled();
});

test('line: 購入済みだが顧客 user_id なし → 400', async () => {
  cfg.entitlements = [{ facility_id: 'fac-1', option_key: 'time_adjust_line' }];
  cfg.booking = bookingRow({ user_id: null });
  const res = await POST(makeRequest({ bookingId: BOOKING_UUID, channel: 'line' }));
  expect(res.status).toBe(400);
});

test('line: LINE 連携なし（link なし）→ 400', async () => {
  cfg.entitlements = [{ facility_id: 'fac-1', option_key: 'time_adjust_line' }];
  cfg.lineLink = null;
  const res = await POST(makeRequest({ bookingId: BOOKING_UUID, channel: 'line' }));
  expect(res.status).toBe(400);
});

test('line 正常系: 購入済み＋連携あり → 施設名・日時入りで送信', async () => {
  cfg.entitlements = [{ facility_id: 'fac-1', option_key: 'time_adjust_line' }];
  const res = await POST(makeRequest({ bookingId: BOOKING_UUID, channel: 'line' }));
  expect(res.status).toBe(200);
  const [lineId, text, opts] = mockSendLineText.mock.calls[0];
  expect(lineId).toBe('LINE-1');
  expect(text).toContain('テストサロン');
  expect(text).toContain('2026-07-01 10:00');
  // 単発送信で他に再送手段が無いため、送信失敗時に webhook_retry_queue へ登録するよう opt-in している
  expect(opts).toEqual({ enqueueOnFailure: true, facilityId: 'fac-1' });
  expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ newValues: { channel: 'line' } }));
});

test('line: 送信失敗（false）→ 502', async () => {
  cfg.entitlements = [{ facility_id: 'fac-1', option_key: 'time_adjust_line' }];
  mockSendLineText.mockResolvedValue(false);
  const res = await POST(makeRequest({ bookingId: BOOKING_UUID, channel: 'line' }));
  expect(res.status).toBe(502);
});

test('予期しない例外 → 500（内部情報は漏らさない）', async () => {
  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockImplementation(() => { throw new Error('boom'); });
  const res = await POST(makeRequest());
  expect(res.status).toBe(500);
  const json = await res.json();
  expect(JSON.stringify(json)).not.toContain('boom');
});
