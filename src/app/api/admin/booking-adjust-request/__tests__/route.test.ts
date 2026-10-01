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
// 【監査C2】連携解決は helper 経由（profiles.line_user_id 単一ソース）。cfg.lineLink を helper へ配線。
jest.mock('@/lib/line-link', () => ({ resolveLineUserIdForUser: jest.fn().mockResolvedValue(null) }));
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
const mockQueue = jest.fn();
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
    rpc: mockQueue,
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
  mockSendEmail = jest.fn().mockImplementation(jest.requireActual('@/lib/email').buildTimeAdjustRequestEnvelope);
  emailModule.buildTimeAdjustRequestEnvelope = mockSendEmail;
  mockQueue.mockImplementation(async () => {
    const message = !['pending','confirmed'].includes(cfg.booking?.status ?? '') ? 'INVALID_BOOKING_TRANSITION'
      : !cfg.booking?.email ? 'BOOKING_EMAIL_MISSING' : null;
    return message ? { data:null,error:{ message } } : { data:[{ operation_id:BOOKING_UUID,replayed:false,notification:'queued' }],error:null };
  });

  const lineModule = require('@/lib/line');
  mockSendLineText = jest.fn().mockResolvedValue(true);
  lineModule.sendLineText = mockSendLineText;

  // 【監査C2】顧客の連携解決は profiles.line_user_id（helper）。test 本文で cfg.lineLink を
  // 書き換えるケースがあるため、実行時に cfg を参照する mockImplementation で反映する。
  const { resolveLineUserIdForUser } = require('@/lib/line-link');
  (resolveLineUserIdForUser as jest.Mock).mockImplementation(async () => cfg.lineLink?.line_user_id ?? null);
}

beforeEach(() => {
  jest.clearAllMocks();
  setup();
});

function makeRequest(body: unknown = { bookingId: BOOKING_UUID, channel: 'email', operationId: BOOKING_UUID }) {
  return new Request('http://localhost/api/admin/booking-adjust-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test.each([null,[],42,'invalid'])('adjustment non-object body %j is rejected before event creation', async body => {
  expect((await POST(makeRequest(body))).status).toBe(400); expect(mockQueue).not.toHaveBeenCalled();
});
test.each(['08006','PGRST116'])('adjustment booking read error %s cannot create an event', async code => {
  const {createServiceRoleClient}=require('@/lib/supabase-server'); const client=createServiceRoleClient();
  const fallback=client.from.getMockImplementation();
  client.from.mockImplementation((table:string) => table==='bookings' ? {
    select:() => ({eq:() => ({single:async () => ({data:null,error:{code,message:'synthetic failure'}})})}),
  } : fallback(table));
  expect((await POST(makeRequest())).status).toBe(code==='PGRST116'?404:500); expect(mockQueue).not.toHaveBeenCalled();
});
test('adjustment membership dependency failure is not authorization', async () => {
  const {createServiceRoleClient}=require('@/lib/supabase-server'); const client=createServiceRoleClient();
  const fallback=client.from.getMockImplementation();
  client.from.mockImplementation((table:string) => table==='facility_members' ? {
    select:() => ({eq:() => ({eq:() => ({in:() => ({maybeSingle:async () => ({data:null,error:{message:'synthetic failure'}})})})})}),
  } : fallback(table));
  expect((await POST(makeRequest())).status).toBe(500); expect(mockQueue).not.toHaveBeenCalled();
});
test('closed LINE request is rejected before delivery', async () => {
  cfg.booking=bookingRow({status:'cancelled'});
  expect((await POST(makeRequest({bookingId:BOOKING_UUID,channel:'line'}))).status).toBe(400);
  expect(mockSendLineText).not.toHaveBeenCalled();
});
test('actual queue database error is not successful acceptance', async () => {
  mockQueue.mockResolvedValue({data:null,error:{message:'08006'}});
  expect((await POST(makeRequest())).status).toBe(500);
});
test.each([undefined, [], [{ operation_id: 'invalid', notification: 'queued' }],
  [{ operation_id: BOOKING_UUID, notification: 'invalid' }]])('malformed adjustment reservation %j is not accepted', async data => {
  mockQueue.mockResolvedValue({data,error:null});
  expect((await POST(makeRequest())).status).toBe(500);
  expect(mockSendLineText).not.toHaveBeenCalled();
});

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
    newValues: { channel: 'email', notification:'queued' },
  }));
});

test('email: 施設名が引けない場合は通知を予約せず500', async () => {
  cfg.facility = null;
  const res = await POST(makeRequest());
  expect(res.status).toBe(500);
  expect(mockQueue).not.toHaveBeenCalled();
});

test('email: 台帳保存の結果不明を送信済み・自動再送保証へ変換しない', async () => {
  mockQueue.mockResolvedValue({ data:null,error:{ message:'08006' } });
  const res = await POST(makeRequest());
  expect(res.status).toBe(500);
  // 失敗分は webhook_retry_queue で自動再送されるため、「時間をおいて再度お試しください」と
  // 手動リトライを促すと自動再送と両方走って確定二重送信になる（文言の回帰固定）。
  const json = await res.json();
  expect(json.error).toContain('受付を確認できません');
  expect(json.error).not.toContain('自動で再送されます');
  expect(json.error).not.toContain('再度お試しください');
});
test.each([
  ['BOOKING_PERMISSION_DENIED',404], ['BOOKING_REVISION_CONFLICT',409], ['BOOKING_OPERATION_CONFLICT',409],
])('email: write-time %s is not success', async (message,status) => {
  mockQueue.mockResolvedValue({ data:null,error:{ message } });
  expect((await POST(makeRequest())).status).toBe(status);
});
test('email: 同じ予約revisionの再確認は既存イベントを返す', async () => {
  mockQueue.mockResolvedValue({ data:[{ operation_id:BOOKING_UUID,replayed:true,notification:'already_queued' }],error:null });
  const res = await POST(makeRequest());
  expect(await res.json()).toEqual({ ok:true,notification:'already_queued' });
  expect(mockQueue).toHaveBeenCalledWith('save_booking_email_event_atomic',expect.objectContaining({ p_new_status:null,p_expected_status:'confirmed',p_operation_id:BOOKING_UUID }));
});
test.each([undefined, 'invalid', 42])('email operation ID %s cannot create a new event', async operationId => {
  expect((await POST(makeRequest({ bookingId:BOOKING_UUID,channel:'email',operationId }))).status).toBe(400);
  expect(mockQueue).not.toHaveBeenCalled();
});
test('old operation is reconciled even after the booking is cancelled', async () => {
  cfg.booking = bookingRow({ status:'cancelled' });
  mockQueue.mockResolvedValue({ data:[{ operation_id:BOOKING_UUID,replayed:true,notification:'already_queued' }],error:null });
  expect(await (await POST(makeRequest())).json()).toEqual({ ok:true,notification:'already_queued' });
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

test('line: 送信失敗（false）→ 502・自動再送案内（手動リトライを誘導しない）', async () => {
  cfg.entitlements = [{ facility_id: 'fac-1', option_key: 'time_adjust_line' }];
  mockSendLineText.mockResolvedValue(false);
  const res = await POST(makeRequest({ bookingId: BOOKING_UUID, channel: 'line' }));
  expect(res.status).toBe(502);
  // 失敗分は enqueueOnFailure で webhook_retry_queue に自動登録され15分毎に再送されるため、
  // 手動リトライを促すと自動再送と両方走って確定二重送信になる（文言の回帰固定）。
  const json = await res.json();
  expect(json.error).toContain('自動で再送されます');
  expect(json.error).toContain('手動での再送は不要');
  expect(json.error).not.toContain('再度お試しください');
});

test('予期しない例外 → 500（内部情報は漏らさない）', async () => {
  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockImplementation(() => { throw new Error('boom'); });
  const res = await POST(makeRequest());
  expect(res.status).toBe(500);
  const json = await res.json();
  expect(JSON.stringify(json)).not.toContain('boom');
});
