/**
 * @jest-environment node
 *
 * Tests for POST/DELETE /api/google-calendar/sync
 * Key assertions:
 *   - DELETE: booking_calendar_events delete failure → 500 (calendar event
 *     removed from Google but DB record remains — inconsistent state flagged)
 *   - POST: booking ownership guard prevents other users from syncing
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));

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
import { checkRateLimit } from '@/lib/rate-limit';
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
  if (data && typeof data==='object' && 'google_event_id' in data) data={id:BOOKING_UUID,calendar_id:'primary',synced_at:'2026-01-01T00:00:00Z',...data};
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error })),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error })),
  };
}

function deleteChain(result: unknown) {
 const chain: Record<string,any>={}; chain.delete=jest.fn(()=>chain);chain.eq=jest.fn(()=>chain);chain.select=jest.fn(async()=>result);return chain;
}

const FUTURE_DATE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

const BOOKING_DATA = {
  id: BOOKING_UUID,
  user_id: USER_ID,
  booking_date: '2026-12-01',
  start_time: '10:00:00',
  // bookings に duration_minutes 列は存在しない（実スキーマは start_time/end_time の
  // TIME 型ペア）。route.ts の修正に合わせ、モックも実スキーマに合わせて end_time を持たせる。
  end_time: '11:00:00',
  facility_profiles: { name: 'テスト施設', address: '東京都' },
  menu: { name: 'テストメニュー' },
};

const TOKEN_ROW = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expires_at: FUTURE_DATE,
};

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
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

test('POST: 追跡行の保存失敗 → 作成済みGoogleイベントをロールバックして500（重複防止）', async () => {
  const { alertCaughtError } = require('@/lib/alert');
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(BOOKING_DATA); // booking
    if (callNum === 2) return singleChain(TOKEN_ROW); // token
    if (callNum === 3) return singleChain(null); // no existing calendar event
    return { upsert: jest.fn(() => Promise.resolve({ error: { message: 'persist failed' } })) };
  });
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: GOOGLE_EVENT_ID }) });

  const res = await POST(makePostReq({ bookingId: BOOKING_UUID }));
  expect(res.status).toBe(500);
  const json = await res.json();
  expect(json.error).toBe('Calendar sync failed');
  // 作成直後の Google イベントを取り消す DELETE が呼ばれること（孤立イベントを残さない）
  const rollbackDelete = mockFetch.mock.calls.find(
    (call) => call[1]?.method === 'DELETE' && String(call[0]).includes(GOOGLE_EVENT_ID),
  );
  expect(rollbackDelete).toBeDefined();
  expect(alertCaughtError).toHaveBeenCalledWith('gcal-sync-track', expect.any(Error), '/api/google-calendar/sync');
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
    if (callNum === 2) return singleChain(TOKEN_ROW); // verified token
    // delete call
    return deleteChain({data:null,error:{message:'DB delete failed'}});
  });
  mockFetch.mockResolvedValue({ ok: true, status:204, json: () => Promise.resolve({}) });

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
    return deleteChain({data:[{id:BOOKING_UUID}],error:null});
  });
  mockFetch.mockResolvedValue({ ok: true, status:204, json: () => Promise.resolve({}) });

  const res = await DELETE(makeDeleteRequest(BOOKING_UUID));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('POST: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makePostReq({ bookingId: BOOKING_UUID }));
  expect(res.status).toBe(429);
});

test('POST: CSRF エラー → 403', async () => {
  const { NextResponse } = jest.requireActual('next/server') as { NextResponse: typeof import('next/server').NextResponse };
  (checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({ error: 'CSRF' }, { status: 403 }));
  const res = await POST(makePostReq({ bookingId: BOOKING_UUID }));
  expect(res.status).toBe(403);
});

test('POST: トークン期限切れ → リフレッシュして同期成功', async () => {
  const expiredToken = { ...TOKEN_ROW, expires_at: new Date(Date.now() - 1000).toISOString() };

  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(BOOKING_DATA);
    if (callNum === 2) return singleChain(expiredToken);
    if (callNum === 3) {
      // token update after refresh
      return {
        update: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) }),
      };
    }
    if (callNum === 4) return singleChain(null); // no existing calendar event
    return { upsert: jest.fn(() => Promise.resolve({ error: null })) };
  });

  // First fetch: token refresh; second: create calendar event
  mockFetch
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ access_token: 'new-token', expires_in: 3600 }) })
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'new-event-id' }) });

  const res = await POST(makePostReq({ bookingId: BOOKING_UUID }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('POST: 既存イベントあり → PUT で更新', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(BOOKING_DATA);
    if (callNum === 2) return singleChain(TOKEN_ROW);
    return singleChain({ google_event_id: GOOGLE_EVENT_ID }); // existing event
  });
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: GOOGLE_EVENT_ID }) });

  const res = await POST(makePostReq({ bookingId: BOOKING_UUID }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.googleEventId).toBe(GOOGLE_EVENT_ID);

  // Verify PUT was called for update
  const putCall = mockFetch.mock.calls.find((call) => call[1]?.method === 'PUT');
  expect(putCall).toBeDefined();
});

test('POST: Google Calendar 新規作成失敗 → 500', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(BOOKING_DATA);
    if (callNum === 2) return singleChain(TOKEN_ROW);
    return singleChain(null); // no existing event
  });
  mockFetch.mockResolvedValue({ ok: false, status: 403 });

  const res = await POST(makePostReq({ bookingId: BOOKING_UUID }));
  expect(res.status).toBe(500);
});

test('POST: Google Calendar 更新失敗 → 500', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(BOOKING_DATA);
    if (callNum === 2) return singleChain(TOKEN_ROW);
    return singleChain({ google_event_id: GOOGLE_EVENT_ID }); // existing event
  });
  mockFetch.mockResolvedValue({ ok: false, status: 403 });

  const res = await POST(makePostReq({ bookingId: BOOKING_UUID }));
  expect(res.status).toBe(500);
});

test('DELETE: 不正なUUID → 400', async () => {
  const url = new URL('http://localhost/api/google-calendar/sync');
  url.searchParams.set('bookingId', 'not-a-uuid');
  const req = new NextRequest(url.toString(), { method: 'DELETE' });
  const res = await DELETE(req);
  expect(res.status).toBe(400);
});

test('DELETE: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await DELETE(makeDeleteRequest(BOOKING_UUID));
  expect(res.status).toBe(429);
});

test('DELETE: トークン期限切れ → リフレッシュして削除', async () => {
  const expiredToken = { access_token: 'old-token', refresh_token: 'ref', expires_at: new Date(Date.now() - 1000).toISOString() };

  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ google_event_id: GOOGLE_EVENT_ID });
    if (callNum === 2) return singleChain(expiredToken);
    return deleteChain({data:[{id:BOOKING_UUID}],error:null});
  });

  mockFetch
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ access_token: 'new-token', expires_in: 3600 }) })
    .mockResolvedValueOnce({ ok: true, status:204 }); // DELETE event call

  const res = await DELETE(makeDeleteRequest(BOOKING_UUID));
  expect(res.status).toBe(200);
});

test('POST: facility_profiles が配列の場合も正常に処理', async () => {
  const bookingWithArrayProfile = {
    ...BOOKING_DATA,
    facility_profiles: [{ name: '施設A', address: '東京都渋谷区' }],
    menu: [{ name: 'カット' }],
  };

  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(bookingWithArrayProfile);
    if (callNum === 2) return singleChain(TOKEN_ROW);
    if (callNum === 3) return singleChain(null);
    return { upsert: jest.fn(() => Promise.resolve({ error: null })) };
  });
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'event-array' }) });

  const res = await POST(makePostReq({ bookingId: BOOKING_UUID }));
  expect(res.status).toBe(200);
});

// Branch coverage: line 22 — refreshAccessToken fetch が ok=false の場合に throw
test('POST: トークンリフレッシュ失敗（fetch ok=false）→ 500', async () => {
  const expiredToken = { ...TOKEN_ROW, expires_at: new Date(Date.now() - 1000).toISOString() };

  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(BOOKING_DATA);
    return singleChain(expiredToken);
  });

  // First fetch: token refresh returns ok=false → throw
  mockFetch.mockResolvedValueOnce({ ok: false, status: 400 });

  const res = await POST(makePostReq({ bookingId: BOOKING_UUID }));
  expect(res.status).toBe(500);
});

// Branch coverage: line 75 — トークン更新後DB保存エラー（ログ出力のみで続行）
test('POST: トークンリフレッシュ後のDB保存失敗でも同期は続行 → 200', async () => {
  const expiredToken = { ...TOKEN_ROW, expires_at: new Date(Date.now() - 1000).toISOString() };

  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(BOOKING_DATA);
    if (callNum === 2) return singleChain(expiredToken);
    if (callNum === 3) {
      // token update after refresh → DB保存エラー
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn(() => Promise.resolve({ error: { message: 'DB save error' } })),
        }),
      };
    }
    if (callNum === 4) return singleChain(null); // no existing calendar event
    return { upsert: jest.fn(() => Promise.resolve({ error: null })) };
  });

  mockFetch
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ access_token: 'new-token', expires_in: 3600 }) })
    .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'new-event-id' }) });

  const res = await POST(makePostReq({ bookingId: BOOKING_UUID }));
  // tokenUpdateErr があってもログのみで処理続行する
  expect(res.status).toBe(200);
});

// Branch coverage: line 92 (×2) — facility_profiles が null の場合の分岐
test('POST: facility_profiles が null → facilityName が undefined → デフォルト名使用', async () => {
  const bookingWithNullProfile = {
    ...BOOKING_DATA,
    facility_profiles: null,
    menu: null,
  };

  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(bookingWithNullProfile);
    if (callNum === 2) return singleChain(TOKEN_ROW);
    if (callNum === 3) return singleChain(null);
    return { upsert: jest.fn(() => Promise.resolve({ error: null })) };
  });
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'event-null-profile' }) });

  const res = await POST(makePostReq({ bookingId: BOOKING_UUID }));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.ok).toBe(true);
});

test('DELETE: ハンドラ内で例外 → 500（catch で alertCaughtError 経由）', async () => {
  const { alertCaughtError } = require('@/lib/alert');
  const expiredToken = { access_token: 'old', refresh_token: 'ref', expires_at: new Date(Date.now() - 1000).toISOString() };
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ google_event_id: GOOGLE_EVENT_ID }); // cal event
    return singleChain(expiredToken); // token（期限切れ → リフレッシュ）
  });
  // トークンリフレッシュの fetch が ok=false → refreshAccessToken が throw → DELETE catch へ
  mockFetch.mockResolvedValueOnce({ ok: false, status: 400 });

  const res = await DELETE(makeDeleteRequest(BOOKING_UUID));
  expect(res.status).toBe(500);
  expect(alertCaughtError).toHaveBeenCalledWith('gcal-sync-delete', expect.any(Error), '/api/google-calendar/sync');
});

// Branch coverage: line 163 — DELETE の CSRF チェック失敗
test('DELETE: CSRF エラー → 403', async () => {
  const { NextResponse } = jest.requireActual('next/server') as { NextResponse: typeof import('next/server').NextResponse };
  (checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({ error: 'CSRF' }, { status: 403 }));
  const res = await DELETE(makeDeleteRequest(BOOKING_UUID));
  expect(res.status).toBe(403);
});


function setupDeletion(readError: unknown=null, tokenError: unknown=null, token: unknown=TOKEN_ROW, removed: unknown={data:[{id:BOOKING_UUID}],error:null}) {
 const mapping=singleChain({google_event_id:GOOGLE_EVENT_ID},readError);const tokenLookup=singleChain(token,tokenError);const mutation=deleteChain(removed);
 let n=0;mockFrom.mockImplementation(()=>[++n===1?mapping:n===2?tokenLookup:mutation][0]);return {mapping,tokenLookup,mutation};
}
test.each([401,403,404,429,500,200])('DELETE providerHTTP%s cannot erase recovery mapping',async status=>{
 const{mutation}=setupDeletion();mockFetch.mockResolvedValue({status,ok:status<400,json:async()=>({})});
 expect((await DELETE(makeDeleteRequest(BOOKING_UUID))).status).toBe(503);expect(mutation.delete).not.toHaveBeenCalled();
});
test.each([null,{}, {error:{errors:[]}}, {error:{errors:[{reason:'fullSyncRequired'}]}}, {error:{errors:'deleted'}}])('DELETE410 unconfirmed body %j retains mapping',async body=>{
 const{mutation}=setupDeletion();mockFetch.mockResolvedValue({status:410,json:async()=>body});expect((await DELETE(makeDeleteRequest(BOOKING_UUID))).status).toBe(503);expect(mutation.delete).not.toHaveBeenCalled();
});
test('DELETE410 deleted is authoritative, same observed mapping only',async()=>{
 const{mutation}=setupDeletion();mockFetch.mockResolvedValue({status:410,json:async()=>({error:{errors:[{reason:'deleted'}]}})});
 expect((await DELETE(makeDeleteRequest(BOOKING_UUID))).status).toBe(200);
 expect(mutation.eq).toHaveBeenCalledWith('google_event_id',GOOGLE_EVENT_ID);expect(mutation.eq).toHaveBeenCalledWith('synced_at','2026-01-01T00:00:00Z');
 expect(mutation.eq).toHaveBeenCalledWith('calendar_id','primary');expect(mutation.eq).toHaveBeenCalledWith('booking_id',BOOKING_UUID);
});
test('DELETE410 malformed JSON cannot confirm absence',async()=>{
 const{mutation}=setupDeletion();mockFetch.mockResolvedValue({status:410,json:async()=>{throw new Error('malformed');}});
 expect((await DELETE(makeDeleteRequest(BOOKING_UUID))).status).toBe(503);expect(mutation.delete).not.toHaveBeenCalled();
});
test('DELETE DB read data plus error and token data plus error stop before external call',async()=>{
 setupDeletion({message:'private'});expect((await DELETE(makeDeleteRequest(BOOKING_UUID))).status).toBe(500);
 setupDeletion(null,{message:'private'});expect((await DELETE(makeDeleteRequest(BOOKING_UUID))).status).toBe(500);expect(mockFetch).not.toHaveBeenCalled();
});
test.each([null,{...TOKEN_ROW,access_token:''},{...TOKEN_ROW,expires_at:'bad',refresh_token:null},{...TOKEN_ROW,expires_at:'2000-01-01',refresh_token:null}])('DELETE unconfirmed token %j preserves mapping',async token=>{
 const{mutation}=setupDeletion(null,null,token);expect((await DELETE(makeDeleteRequest(BOOKING_UUID))).status).toBe(503);expect(mutation.delete).not.toHaveBeenCalled();
});
test('DELETE malformed mapping is not a harmless no-op',async()=>{mockFrom.mockReturnValue(singleChain({google_event_id:''}));expect((await DELETE(makeDeleteRequest(BOOKING_UUID))).status).toBe(500);expect(mockFetch).not.toHaveBeenCalled();});
test('DELETE unknown provider acceptance leaves mapping for later410 reconciliation',async()=>{
 const{mutation}=setupDeletion();mockFetch.mockRejectedValue(new Error('synthetic response lost'));expect((await DELETE(makeDeleteRequest(BOOKING_UUID))).status).toBe(500);expect(mutation.delete).not.toHaveBeenCalled();
});
test('DELETE malformed credential JSON never leaks its response fragment to monitoring', async () => {
 const { mutation } = setupDeletion(null, null, { ...TOKEN_ROW, expires_at: '2000-01-01' });
 const privateFragment = 'synthetic-private-refresh-token-value';
 mockFetch.mockResolvedValueOnce(new Response(privateFragment, { status: 200 }));
 const { alertCaughtError } = require('@/lib/alert');
 expect((await DELETE(makeDeleteRequest(BOOKING_UUID))).status).toBe(500);
 expect(mutation.delete).not.toHaveBeenCalled();
 const error = (alertCaughtError as jest.Mock).mock.calls.at(-1)![1] as Error;
 expect(error.message).toBe('Calendar deletion outcome unconfirmed');
 expect(error.stack).not.toContain(privateFragment);
});
test('DELETE malformed refreshed credentials stop before event deletion', async () => {
 const { mutation } = setupDeletion(null, null, { ...TOKEN_ROW, expires_at: '2000-01-01' });
 mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: '', expires_in: 3600 }) });
 expect((await DELETE(makeDeleteRequest(BOOKING_UUID))).status).toBe(500);
 expect(mockFetch).toHaveBeenCalledTimes(1);expect(mutation.delete).not.toHaveBeenCalled();
});
test('DELETE rejects a refreshed token parsed after its deadline even before the timeout callback runs', async () => {
 const fixed = Date.now(); const clock = jest.spyOn(Date, 'now').mockReturnValue(fixed);
 try {
  const { mutation } = setupDeletion(null, null, { ...TOKEN_ROW, expires_at: '2000-01-01' });
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => {
   clock.mockReturnValue(fixed + 10_000);return { access_token: 'synthetic-token', expires_in: 3600 };
  } });
  expect((await DELETE(makeDeleteRequest(BOOKING_UUID))).status).toBe(500);
  expect(mockFetch).toHaveBeenCalledTimes(1);expect(mutation.delete).not.toHaveBeenCalled();
 } finally { clock.mockRestore(); }
});
test.each([{data:[],error:null},{data:[{id:'another-id'}],error:null},{data:null,error:null}])('DELETE CAS lost mapping %j is409 not blanket erasure',async removed=>{
 setupDeletion(null,null,TOKEN_ROW,removed);mockFetch.mockResolvedValue({status:204});expect((await DELETE(makeDeleteRequest(BOOKING_UUID))).status).toBe(409);
});
test('DELETE inconsistent auth with user is503 and never touches provider/mapping',async()=>{
 mockGetUser.mockResolvedValue({data:{user:{id:USER_ID}},error:{code:'unknown'}});expect((await DELETE(makeDeleteRequest(BOOKING_UUID))).status).toBe(503);expect(mockFrom).not.toHaveBeenCalled();
});
