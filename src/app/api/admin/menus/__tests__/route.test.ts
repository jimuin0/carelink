/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for GET/POST /api/admin/menus
 * Key assertions:
 *   - Non-member → 401 (IDOR prevention)
 *   - Duplicate name → 409
 *   - photo_url must be URL or empty string
 *   - name max 100 chars
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn(), getRequestContext: () => ({ ua: null }) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const FACILITY_UUID = '22222222-2222-4222-8222-222222222222';
const USER_ID       = '33333333-3333-3333-3333-333333333333';

const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockAdminFrom = jest.fn();
const mockRpc = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom, rpc: mockRpc }),
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { checkCsrf } from '@/lib/csrf';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-logger';

function makeGetRequest(facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/menus');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), { method: 'GET' });
}

function makePostRequest(body: object, facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/menus');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: object = {}) {
  return { category: 'カラー', name: 'テストメニュー', duration_minutes: 60, ...overrides };
}

function memberSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function snapshotResult(data: unknown[], error: unknown = null) {
  return { data: { menus: data.map(() => ({ id: '11111111-1111-4111-8111-111111111111', facility_id: FACILITY_UUID })), revision: null }, error };
}

beforeEach(() => {
 jest.clearAllMocks(); mockRpc.mockReset(); mockAdminFrom.mockReset();
 (checkRateLimit as jest.Mock).mockReturnValue(false); (checkCsrf as jest.Mock).mockReturnValue(null);
 mockGetUser.mockResolvedValue({data:{user:{id:USER_ID}}});
 mockAnonFrom.mockReturnValue(memberSingle({facility_id:FACILITY_UUID}));
 mockRpc.mockResolvedValue({data:{id:'11111111-1111-4111-8111-111111111111',facility_id:FACILITY_UUID},error:null});
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test-key';
});
test('GET: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(401);
});


test('GET: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(429);
});


test('GET: 非管理者 → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(401);
});


test('GET: 正常取得 → 200 with menus', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockRpc.mockResolvedValue(snapshotResult([{ id: 'menu-1' }]));
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.menus).toBeDefined();
});

// ─── POST ─────────────────────────────────────────────────────────────────────


test('GET: DB失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockRpc.mockResolvedValue(snapshotResult([], { message: 'DB error' }));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(500);
});


test('GET: rate limit params (30/60s)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockRpc.mockResolvedValue(snapshotResult([]));
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await GET(makeGetRequest());
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(30);
  expect(call[3]).toBe(60_000);
});


test('GET: レスポンスが { menus: [] } 形式', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockRpc.mockResolvedValue(snapshotResult([]));
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(Array.isArray(json.menus)).toBe(true);
});


test('GET: facility_id クエリなし → 401', async () => {
  const res = await GET(makeGetRequest(null));
  expect(res.status).toBe(401);
});


test('GET: facility_id が不正UUID → 401', async () => {
  const res = await GET(makeGetRequest('bad-uuid'));
  expect(res.status).toBe(401);
});


test('GET: x-forwarded-for ヘッダあり → IP抽出', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockRpc.mockResolvedValue(snapshotResult([]));
  (checkRateLimit as jest.Mock).mockClear();
  const url = new URL('http://localhost/api/admin/menus');
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), {
    method: 'GET',
    headers: { 'x-forwarded-for': '10.0.0.1, 192.168.1.1' },
  });
  await GET(req);
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[1]).toBe('192.168.1.1');
});


test.each([['42501',403],['P0002',404],['08006',500]])('GET current DB scope error %s rejects partial snapshot',async(code,status)=>{
 mockAnonFrom.mockReturnValue(memberSingle({facility_id:FACILITY_UUID})); mockRpc.mockResolvedValue({data:{menus:[],revision:null},error:{code,message:'PRIVATE_DETAIL'}});
 const response=await GET(makeGetRequest());expect(response.status).toBe(status);expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_DETAIL');
});

test.each([null,{menus:[],revision:'invalid'},{menus:[{id:'11111111-1111-4111-8111-111111111111',facility_id:'99999999-9999-4999-8999-999999999999'}],revision:null}])('GET malformed or foreign snapshot is never exposed %#',async data=>{
 mockAnonFrom.mockReturnValue(memberSingle({facility_id:FACILITY_UUID}));mockRpc.mockResolvedValue({data,error:null});expect((await GET(makeGetRequest())).status).toBe(500);
});

test.each([
 {name:''},{name:'x'.repeat(101)},{category:''},{category:'x'.repeat(51)},
 {price:-1},{price:10000000},{price:0.5},{duration_minutes:-1},{duration_minutes:1441},{duration_minutes:0},{duration_minutes:14},{duration_minutes:481},{duration_minutes:30.5},{duration_minutes:null},{duration_minutes:'60'},
 {sort_order:-1},{description:'x'.repeat(501)},{price_note:'x'.repeat(101)},
 {photo_url:'not-a-url'},{photo_url:'https://images.unsplash.com/new'},
])('POST rejects invalid fields before RPC: %p',async body=>{
 expect((await POST(makePostRequest(validBody(body)))).status).toBe(400);expect(mockRpc).not.toHaveBeenCalled();
});
test.each([{},{photo_url:''},{photo_url:null},{photo_url:'https://example.invalid/photo.jpg'},{sort_order:99},{price:0,duration_minutes:15,is_featured:false},{duration_minutes:480}])('POST durable scoped creation: %p',async values=>{
 const r=await POST(makePostRequest(validBody(values)));expect(r.status).toBe(201);expect((await r.json()).menu.facility_id).toBe(FACILITY_UUID);
 expect(mockAdminFrom).not.toHaveBeenCalled();expect(mockRpc).toHaveBeenCalledWith('save_admin_menu_atomic',expect.objectContaining({p_actor_id:USER_ID,p_facility_id:FACILITY_UUID,p_menu_id:null}));expect(writeAuditLog).toHaveBeenCalledTimes(1);
});
test.each([['42501',403],['P0002',404],['23505',409],['40001',409],['22023',400],['57014',500]])('POST SQL failure %s has no success audit',async(code,status)=>{
 mockRpc.mockResolvedValue({data:null,error:{code,message:'PRIVATE_DETAIL'}});const r=await POST(makePostRequest(validBody()));expect(r.status).toBe(status);expect(writeAuditLog).not.toHaveBeenCalled();expect(JSON.stringify(await r.json())).not.toContain('PRIVATE_DETAIL');
});
test('POST unauthenticated',async()=>{mockGetUser.mockResolvedValue({data:{user:null}});expect((await POST(makePostRequest(validBody()))).status).toBe(401);expect(mockRpc).not.toHaveBeenCalled();});
test('POST CSRF',async()=>{(checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({}, {status:403}));expect((await POST(makePostRequest(validBody()))).status).toBe(403);expect(mockRpc).not.toHaveBeenCalled();});
test('POST rate limit',async()=>{(checkRateLimit as jest.Mock).mockReturnValue(true);expect((await POST(makePostRequest(validBody()))).status).toBe(429);});
test('POST rate bucket and trusted IP',async()=>{const r=new NextRequest('http://localhost/api/admin/menus?facility_id='+FACILITY_UUID,{method:'POST',headers:{'Content-Type':'application/json','x-forwarded-for':'10.0.0.1, 192.168.1.1'},body:JSON.stringify(validBody())});await POST(r);expect(checkRateLimit).toHaveBeenCalledWith(null,'192.168.1.1',20,60000,'admin-menus-post');});
test('POST malformed JSON',async()=>{expect((await POST(new NextRequest('http://localhost/api/admin/menus?facility_id='+FACILITY_UUID,{method:'POST',body:'{'}))).status).toBe(400);});
test('POST strips forged scope keys',async()=>{await POST(makePostRequest(validBody({facility_id:USER_ID,id:USER_ID,user_id:USER_ID})));expect(mockRpc.mock.calls[0][1].p_values).toEqual({category:'カラー',name:'テストメニュー',duration_minutes:60,photo_url:null});});
// 2026年10月23日: 所要時間は画面の入力欄と同じ 15〜480 分の整数をサーバーでも強制する（以前は 0〜1440 分を通した）。
describe('POST の所要時間（15〜480 分・必須）', () => {
 test.each([[{duration_minutes:0}],[{duration_minutes:481}],[{duration_minutes:null}],[{duration_minutes:undefined}]])('%p は何を直せばよいかを 400 で返す',async values=>{
  const r=await POST(makePostRequest(validBody(values)));expect(r.status).toBe(400);
  expect((await r.json()).error).toBe('所要時間は15〜480分の整数で入力してください');expect(mockRpc).not.toHaveBeenCalled();
 });
 test('所要時間以外の誤りは従来の文言',async()=>{
  const r=await POST(makePostRequest(validBody({name:''})));expect(r.status).toBe(400);expect((await r.json()).error).toBe('リクエストが不正です');
 });
});
