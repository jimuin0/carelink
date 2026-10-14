/**
 * @jest-environment node
 *
 * Tests for PATCH/DELETE /api/admin/coupons/[id]
 * Key assertions:
 *   - facility_id defence-in-depth in UPDATE/DELETE WHERE clause
 *   - percentage discount_value > 100 rejected by Zod refine
 *   - IDOR: other facility's coupon → 401
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const COUPON_UUID = '11111111-1111-1111-1111-111111111111';
const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const mockAdminFrom = jest.fn();
const mockRpc = jest.fn();
const mockAnonFrom = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom, rpc: mockRpc }),
}));

import { PATCH, DELETE } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeRequest(method: string, body?: object) {
  return new Request(`http://localhost/api/admin/coupons/1`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeProps(id = COUPON_UUID) {
  return { params: Promise.resolve({ id }) };
}

function singleChain(data: unknown, error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error })),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error })),
  };
}

// Sets up coupon lookup (admin) + membership check (anon)
function setupOwnership() {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    return buildUpdateOrDeleteChain();
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));
}

function buildUpdateOrDeleteChain(error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            maybeSingle: jest.fn(() => Promise.resolve({ data: { id: COUPON_UUID }, error })),
          }),
        }),
      }),
    }),
    delete: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn(() => Promise.resolve({ data: error ? null : [{ id: COUPON_UUID }], error })),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRpc.mockResolvedValue({ data: [{ id: COUPON_UUID, facility_id: FACILITY_UUID }], error: null });
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── DELETE: guards ───────────────────────────────────────────────────────────

test('DELETE: 不正なUUID → 400', async () => {
  const res = await DELETE(makeRequest('DELETE'), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('DELETE: 他施設のクーポン → 401', async () => {
  mockAdminFrom.mockReturnValue(singleChain({ facility_id: 'other-facility' }));
  mockAnonFrom.mockReturnValue(singleChain(null));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(401);
});

function redemptionCountChain(count: number, error: unknown = null) {
  return { select: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ count, error })) }) };
}

test('DELETE: 利用実績なし → DELETEのWHEREにfacility_idが含まれ成功 → 200', async () => {
  let adminCallNum = 0;
  const innerEq = jest.fn().mockReturnValue({ select: jest.fn(() => Promise.resolve({ data: [{ id: COUPON_UUID }], error: null })) });
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  const deleteMock = jest.fn().mockReturnValue({ eq: outerEq });

  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    if (adminCallNum === 2) return redemptionCountChain(0);
    return { delete: deleteMock };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

  const res = await DELETE(makeRequest('DELETE'), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.message).toBe('deleted');
  expect(outerEq).toHaveBeenCalledWith('id', COUPON_UUID);
  expect(innerEq).toHaveBeenCalledWith('facility_id', FACILITY_UUID);
});

test('DELETE: 利用実績あり → 削除せず無効化のみ → 200', async () => {
  let adminCallNum = 0;
  const updateSelect = jest.fn(() => Promise.resolve({ data: [{ id: COUPON_UUID }], error: null }));
  const updateEq2 = jest.fn().mockReturnValue({ select: updateSelect });
  const updateEq1 = jest.fn().mockReturnValue({ eq: updateEq2 });
  const updateMock = jest.fn().mockReturnValue({ eq: updateEq1 });

  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    if (adminCallNum === 2) return redemptionCountChain(3);
    return { update: updateMock };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

  const res = await DELETE(makeRequest('DELETE'), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.message).toBe('利用実績があるため無効化しました');
  expect(updateMock).toHaveBeenCalledWith({ is_active: false });
});

test('DELETE: 利用実績あり → 無効化のDB更新自体が失敗 → 500', async () => {
  let adminCallNum = 0;
  const updateSelect = jest.fn(() => Promise.resolve({ data: null, error: { message: 'DB error' } }));
  const updateEq2 = jest.fn().mockReturnValue({ select: updateSelect });
  const updateEq1 = jest.fn().mockReturnValue({ eq: updateEq2 });
  const updateMock = jest.fn().mockReturnValue({ eq: updateEq1 });

  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    if (adminCallNum === 2) return redemptionCountChain(3);
    return { update: updateMock };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(500);
});

test('DELETE: 利用実績あり・無効化0行（verify後にTOCTOU削除）→ 404', async () => {
  let adminCallNum = 0;
  const updateSelect = jest.fn(() => Promise.resolve({ data: [], error: null }));
  const updateEq2 = jest.fn().mockReturnValue({ select: updateSelect });
  const updateEq1 = jest.fn().mockReturnValue({ eq: updateEq2 });
  const updateMock = jest.fn().mockReturnValue({ eq: updateEq1 });

  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    if (adminCallNum === 2) return redemptionCountChain(3);
    return { update: updateMock };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(404);
});

test('DELETE: 利用実績カウント取得失敗 → 500', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    return redemptionCountChain(0, { message: 'DB error' });
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(500);
});

test('DELETE: DB削除失敗 → 500', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    if (adminCallNum === 2) return redemptionCountChain(0);
    return {
      delete: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn(() => Promise.resolve({ data: null, error: { message: 'DB error' } })),
          }),
        }),
      }),
    };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(500);
});

test('DELETE: 利用実績なし・削除0行 (verify後にTOCTOU削除) → 404', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    if (adminCallNum === 2) return redemptionCountChain(0);
    return {
      delete: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn(() => Promise.resolve({ data: [], error: null })),
          }),
        }),
      }),
    };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(404);
});

test('DELETE: CSRFエラー → そのまま返却', async () => {
  const csrfRes = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfRes);
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res).toBe(csrfRes);
});

test('DELETE: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(429);
});

test('DELETE: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(401);
});

describe('PATCH atomic fields and restrictions',()=>{
 beforeEach(()=>{setupOwnership();});
 test('normal partial update invokes one transaction; omitted restrictions remain unchanged',async()=>{
  expect((await PATCH(makeRequest('PATCH',{name:'Updated'}),makeProps())).status).toBe(200);
  expect(mockRpc).toHaveBeenCalledWith('save_admin_coupon_atomic',{p_actor_id:USER_ID,p_facility_id:FACILITY_UUID,p_coupon_id:COUPON_UUID,p_fields:{name:'Updated'},p_target_menu_ids:null});
 });
 test('empty target array explicitly removes restriction',async()=>{expect((await PATCH(makeRequest('PATCH',{target_menu_ids:[]}),makeProps())).status).toBe(200);expect(mockRpc).toHaveBeenCalledWith('save_admin_coupon_atomic',expect.objectContaining({p_target_menu_ids:[],p_fields:{}}));});
 test('nonempty targets are committed with normalized coupon fields',async()=>{const target=['44444444-4444-4444-8444-444444444444'];expect((await PATCH(makeRequest('PATCH',{discount_type:'special_price',special_price:500,discount_value:50,target_menu_ids:target}),makeProps())).status).toBe(200);expect(mockRpc).toHaveBeenCalledWith('save_admin_coupon_atomic',expect.objectContaining({p_target_menu_ids:target,p_fields:expect.objectContaining({discount_value:null,special_price:500})}));});
 test.each([['42501',401],['22023',400],['08006',500]])('failed transaction %s returns %s without success audit',async(code,status)=>{mockRpc.mockResolvedValue({data:null,error:{code,message:'private'}});expect((await PATCH(makeRequest('PATCH',{name:'Updated'}),makeProps())).status).toBe(status);const {writeAuditLog}=require('@/lib/audit-logger');expect(writeAuditLog).not.toHaveBeenCalled();expect(mockAdminFrom).toHaveBeenCalledTimes(1);});
 test('missing/deleted row after lookup returns 404',async()=>{mockRpc.mockResolvedValue({data:[],error:null});expect((await PATCH(makeRequest('PATCH',{name:'Updated'}),makeProps())).status).toBe(404);});
 test.each([{discount_value:1},{special_price:1},{discount_type:'percentage',discount_value:101},{name:''},{target_menu_ids:['bad']}])('invalid patch cannot write: %j',async body=>{expect((await PATCH(makeRequest('PATCH',body),makeProps())).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});
 test('malformed JSON cannot write',async()=>{expect((await PATCH(new Request('https://localhost/api/admin/coupons/id',{method:'PATCH',body:'{'}),makeProps())).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();});
 test('bad coupon UUID cannot write',async()=>{expect((await PATCH(makeRequest('PATCH',{name:'x'}),makeProps('bad'))).status).toBe(400);});
 test('CSRF refusal cannot write',async()=>{(checkCsrf as jest.Mock).mockReturnValue(new Response('{}',{status:403}));expect((await PATCH(makeRequest('PATCH',{name:'x'}),makeProps())).status).toBe(403);});
 test('rate limit cannot write',async()=>{(checkRateLimit as jest.Mock).mockReturnValue(true);expect((await PATCH(makeRequest('PATCH',{name:'x'}),makeProps())).status).toBe(429);});
 test.each([PATCH,DELETE])('unavailable identity with provider user data cannot authorize mutation',async route=>{mockGetUser.mockResolvedValue({data:{user:{id:USER_ID}},error:{status:503}});expect((await route(makeRequest(route===PATCH?'PATCH':'DELETE',{name:'x'}),makeProps())).status).toBe(503);expect(mockAdminFrom).not.toHaveBeenCalled();});
 test('no identity returns 401',async()=>{mockGetUser.mockResolvedValue({data:{user:null},error:null});expect((await PATCH(makeRequest('PATCH',{name:'x'}),makeProps())).status).toBe(401);});
 test.each([PATCH,DELETE])('coupon read error with data cannot authorize mutation',async route=>{mockAdminFrom.mockReturnValue(singleChain({facility_id:FACILITY_UUID},{code:'08006'}));expect((await route(makeRequest(route===PATCH?'PATCH':'DELETE',{name:'x'}),makeProps())).status).toBe(500);expect(mockRpc).not.toHaveBeenCalled();});
 test.each([PATCH,DELETE])('membership read error with data cannot authorize mutation',async route=>{mockAnonFrom.mockReturnValue(singleChain({facility_id:FACILITY_UUID},{code:'08006'}));expect((await route(makeRequest(route===PATCH?'PATCH':'DELETE',{name:'x'}),makeProps())).status).toBe(500);expect(mockRpc).not.toHaveBeenCalled();});
 test('nonmember cannot save public coupon',async()=>{mockAnonFrom.mockReturnValue(singleChain(null));expect((await PATCH(makeRequest('PATCH',{name:'x'}),makeProps())).status).toBe(401);expect(mockRpc).not.toHaveBeenCalled();});
 test('missing coupon before lookup has no mutation',async()=>{mockAdminFrom.mockReturnValue(singleChain(null));expect((await PATCH(makeRequest('PATCH',{name:'x'}),makeProps())).status).toBe(401);expect(mockRpc).not.toHaveBeenCalled();});
});
