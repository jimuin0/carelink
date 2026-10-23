/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/white-label/verify
 * Key assertions:
 *   - DNS verified but DB write fails → 500 (previously returned { verified: true } — bug)
 *   - DNS lookup failure → 200 { verified: false } (not an error)
 *   - TXT record mismatch → 200 { verified: false }
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));
jest.mock('dns', () => ({ promises: { resolveTxt: jest.fn() } }));
jest.mock('@/lib/email', () => ({ sendOperatorNotification: jest.fn(() => Promise.resolve(true)) }));
jest.mock('@/lib/after-response', () => ({ runAfterResponse: jest.fn((task: () => Promise<unknown>) => task()) }));


const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const mockAdminFrom = jest.fn();
const mockRpc = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: jest.fn(), auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom, rpc: mockRpc }),
}));

import { POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';
import { promises as dns } from 'dns';
import { sendOperatorNotification } from '@/lib/email';
import { runAfterResponse } from '@/lib/after-response';

const DOMAIN_CONFIG = {
  domain: 'example-salon.com',
  txt_record: 'carelink-verify=abc123xyz',
};

function makeRequest() {
  return new Request('http://localhost/api/admin/white-label/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

function singleChain(data: unknown, error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error })),
    maybeSingle: jest.fn(() => Promise.resolve({data,error})),
  };
}

// 監査A2: getAdminFacilityIds は .select().eq().in() が直接配列Promiseを返す形（single()なし）。
function facilityIdsChain(facilityIds: string[]) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn(() => Promise.resolve({ data: facilityIds.map((facility_id) => ({ facility_id })) })),
  };
}

// update().eq('facility_id',...).eq('domain',...).eq('txt_record',...).select('facility_id')
// TOCTOU根治後は複数 .eq() を経て最後に .select() で更新行を受け取る形になる。
// updatedRows 省略時は「error 無し→1行更新」「error 有り→null」を既定値とする。
function updateChain(error: unknown = null, updatedRows?: unknown[] | null) {
  const rows = updatedRows !== undefined ? updatedRows : (error ? null : [{ facility_id: FACILITY_UUID }]);
  const chainObj: Record<string, jest.Mock> = {};
  chainObj.eq = jest.fn(() => chainObj);
  chainObj.select = jest.fn(() => Promise.resolve({ data: rows, error }));
  return {
    update: jest.fn(() => chainObj),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRpc.mockImplementation(async(_name,args)=>{const r=await mockAdminFrom('white_label_domains').update({is_verified:true}).eq('facility_id',args.p_facility_id).eq('domain',args.p_expected.domain).eq('txt_record',args.p_expected.txt_record).select('facility_id');return {...r,error:r.error || (!r.data?.length ? {code:'40001'} : null),data:r.data?.length ? {id:args.p_facility_id,facility_id:args.p_facility_id,...args.p_expected,is_verified:true} : null};});
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// Helper: setup ownership + domain config chain
function setupOwnershipAndDomain(updateError: unknown = null, updatedRows?: unknown[] | null) {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdsChain([FACILITY_UUID]); // membership
    if (callNum === 2) return singleChain(DOMAIN_CONFIG); // domain config
    return updateChain(updateError, updatedRows); // verify update
  });
}

// ─── Security guards ──────────────────────────────────────────────────────────

test('未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  mockAdminFrom.mockReturnValue(facilityIdsChain([]));
  const res = await POST(makeRequest());
  expect(res.status).toBe(401);
});

test('レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest());
  expect(res.status).toBe(429);
});

test('施設が見つからない → 403', async () => {
  mockAdminFrom.mockReturnValue(facilityIdsChain([])); // no facility membership
  const res = await POST(makeRequest());
  expect(res.status).toBe(403);
});

test('ドメイン設定なし → 400', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdsChain([FACILITY_UUID]);
    return singleChain(null); // no domain config
  });
  const res = await POST(makeRequest());
  expect(res.status).toBe(400);
});

// ─── DNS verification ─────────────────────────────────────────────────────────

test('DNS lookup失敗 → 200 { verified: false, reason: DNS lookup failed }', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdsChain([FACILITY_UUID]);
    return singleChain(DOMAIN_CONFIG);
  });
  (dns.resolveTxt as jest.Mock).mockRejectedValue(new Error('ENOTFOUND'));

  const res = await POST(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.verified).toBe(false);
  expect(json.reason).toBe('DNS lookup failed');
});

test('TXTレコード不一致 → 200 { verified: false }', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdsChain([FACILITY_UUID]);
    return singleChain(DOMAIN_CONFIG);
  });
  (dns.resolveTxt as jest.Mock).mockResolvedValue([['wrong-record']]);

  const res = await POST(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.verified).toBe(false);
});

test.each([null, ''])('verification token missing (%p) never performs DNS or a write', async token => {
  let calls=0;
  mockAdminFrom.mockImplementation(()=>++calls===1?facilityIdsChain([FACILITY_UUID]):singleChain({...DOMAIN_CONFIG,txt_record:token}));
  const res=await POST(makeRequest());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({verified:false,reason:'Verification token missing'});
  expect(dns.resolveTxt).not.toHaveBeenCalled();
  expect(mockRpc).not.toHaveBeenCalled();
});
test.each([
  {records:[[DOMAIN_CONFIG.txt_record.slice(0,12),DOMAIN_CONFIG.txt_record.slice(12)]],verified:true},
  {records:[[DOMAIN_CONFIG.txt_record,'suffix']],verified:false},
  {records:[[DOMAIN_CONFIG.txt_record.slice(0,12)],[DOMAIN_CONFIG.txt_record.slice(12)]],verified:false},
])('TXT ownership compares complete records: %p',async ({records,verified})=>{
  setupOwnershipAndDomain();
  (dns.resolveTxt as jest.Mock).mockResolvedValue(records);
  const res=await POST(makeRequest());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({verified});
  expect(mockRpc).toHaveBeenCalledTimes(verified?1:0);
});

// ─── Critical: DB write failure after successful verification ─────────────────

test('DNS検証成功 + DB書き込み失敗 → 500 (以前はverified:trueを返していたバグ)', async () => {
  setupOwnershipAndDomain({ message: 'DB update failed' });
  (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]);

  const res = await POST(makeRequest());
  // Must return 500 — returning verified:true without DB persistence would mean
  // the domain appears verified on next request but the DB disagrees
  expect(res.status).toBe(500);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test('DNS検証成功 + DB更新成功 → 200 { verified: true }', async () => {
  setupOwnershipAndDomain(null); // no DB error
  (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]);

  const res = await POST(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.verified).toBe(true);
});

// ─── TOCTOU: DNS待機中にドメイン/TXTレコードが変更された場合の恒久根治 ─────────
test('DNS待機中にドメイン設定が変更された(0行更新) → verified:false(古い設定を検証済みと偽らない)', async () => {
  setupOwnershipAndDomain(null, []); // update matches 0 rows (domain/txt_record changed mid-flight)
  (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]);

  const res = await POST(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.verified).toBe(false);
  expect(json.reason).toBe('Domain configuration changed during verification');
});

test('ネストしたTXTレコード配列も正しく照合される', async () => {
  setupOwnershipAndDomain(null);
  // resolveTxt returns array of arrays (chunked records)
  (dns.resolveTxt as jest.Mock).mockResolvedValue([
    ['other-record'],
    [DOMAIN_CONFIG.txt_record],
  ]);

  const res = await POST(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.verified).toBe(true);
});

test('レートリミット params', async () => {
  setupOwnershipAndDomain(null);
  (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]);
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await POST(makeRequest());
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBeGreaterThan(0);
  expect(call[3]).toBe(60_000);
});

test('レスポンスが { verified: true } 形式', async () => {
  setupOwnershipAndDomain(null);
  (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]);
  const res = await POST(makeRequest());
  const json = await res.json();
  expect(json.verified).toBe(true);
});

// ─── Branch coverage gaps ─────────────────────────────────────────────────────

test('CSRF エラー → 403', async () => {
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makeRequest());
  expect(res.status).toBe(403);
});

test('x-forwarded-for ヘッダあり → IP抽出', async () => {
  setupOwnershipAndDomain(null);
  (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]);
  (checkRateLimit as jest.Mock).mockClear();
  const req = new Request('http://localhost/api/admin/white-label/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1, 1.2.3.4' },
    body: '{}',
  });
  await POST(req);
  expect((checkRateLimit as jest.Mock).mock.calls[0][1]).toBe('1.2.3.4');
});

// ─── 監査A2: 複数施設所有者の非決定的施設選択の根治確認 ────────────────────────

const FACILITY_UUID_2 = '44444444-4444-4444-4444-444444444444';

function makeRequestWithFacilityId(facilityId: string) {
  return new Request('http://localhost/api/admin/white-label/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ facility_id: facilityId }),
  });
}

test('複数施設所有・facility_id未指定 → 400', async () => {
  mockAdminFrom.mockReturnValue(facilityIdsChain([FACILITY_UUID, FACILITY_UUID_2]));
  const res = await POST(makeRequest());
  expect(res.status).toBe(400);
});

test('複数施設所有・所属していないfacility_id指定 → 403（越境防止）', async () => {
  mockAdminFrom.mockReturnValue(facilityIdsChain([FACILITY_UUID, FACILITY_UUID_2]));
  const res = await POST(makeRequestWithFacilityId('99999999-9999-9999-9999-999999999999'));
  expect(res.status).toBe(403);
});

test('不正なJSON body → 検証・書込み前に400', async () => {
  setupOwnershipAndDomain(null);
  (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]);
  const req = new Request('http://localhost/api/admin/white-label/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
  expect(mockRpc).not.toHaveBeenCalled();
});

test.each([null,DOMAIN_CONFIG])('lookup outage cannot certify DNS or pretend no config: %p',async data=>{let n=0;mockAdminFrom.mockImplementation(()=>++n===1?facilityIdsChain([FACILITY_UUID]):singleChain(data,{code:'08006',message:'private'}));const res=await POST(makeRequest());expect(res.status).toBe(500);expect(dns.resolveTxt).not.toHaveBeenCalled();expect(mockRpc).not.toHaveBeenCalled();});

// The existing admin UI intentionally submits a bodyless POST.
test('existing bodyless UI verification request still verifies the configured facility',async()=>{
 setupOwnershipAndDomain();
 (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]);
 const request=new Request('http://localhost/api/admin/white-label/verify',{method:'POST'});
 const res=await POST(request as Parameters<typeof POST>[0]);
 expect(res.status).toBe(200);expect(await res.json()).toEqual({verified:true});
 expect(mockRpc).toHaveBeenCalledWith('save_admin_facility_integration_atomic',expect.objectContaining({p_facility_id:FACILITY_UUID,p_kind:'domain:verify'}));
});

// 回帰（2026年10月23日）: 認証に成功すると画面は「予約ページが利用可能です」と出すのに、独自ドメインで予約ページを
// 出す処理は無く、運営にも何も届かなかった。成功したときだけ、運営へ設定依頼を応答後に送る。
describe('operator is asked to set the verified domain up', () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  test('a successful verification sends one request after the response, naming the facility and domain', async () => {
    setupOwnershipAndDomain(null);
    (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]);
    const res = await POST(makeRequest());
    expect(await res.json()).toEqual({ verified: true });
    await flush();
    // 監査ログ（writeAuditLog）も同じ経路を通るので、件数ではなく「応答後の経路を通ったこと」を見る。
    expect(runAfterResponse).toHaveBeenCalled();
    expect(sendOperatorNotification).toHaveBeenCalledTimes(1);
    const sent = (sendOperatorNotification as jest.Mock).mock.calls[0][0];
    expect(sent.subject).toContain('設定依頼');
    expect(sent.lines).toEqual(expect.arrayContaining([
      { label: '施設ID', value: FACILITY_UUID },
      { label: 'ドメイン', value: DOMAIN_CONFIG.domain },
    ]));
  });

  test.each([
    ['TXT mismatch', () => { setupOwnershipAndDomain(null); (dns.resolveTxt as jest.Mock).mockResolvedValue([['wrong-record']]); }],
    ['configuration changed', () => { setupOwnershipAndDomain(null, []); (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]); }],
    ['save failure', () => { setupOwnershipAndDomain({ message: 'DB update failed' }); (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]); }],
  ])('%s sends nothing', async (_label, arrange) => {
    arrange();
    await POST(makeRequest());
    await flush();
    expect(sendOperatorNotification).not.toHaveBeenCalled();
  });

  // 回帰（2026年10月23日・レビュー指摘）: 認証済みのドメインでも verify のたびに同じ設定依頼を運営へ送っていた。
  test('verifying an already verified domain again sends no second request', async () => {
    let callNum = 0;
    mockAdminFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return facilityIdsChain([FACILITY_UUID]);
      if (callNum === 2) return singleChain({ ...DOMAIN_CONFIG, is_verified: true });
      return updateChain(null);
    });
    (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]);
    expect(await (await POST(makeRequest())).json()).toEqual({ verified: true });
    await flush();
    expect(sendOperatorNotification).not.toHaveBeenCalled();
  });

  test('a domain that was not verified yet (is_verified false) sends the request', async () => {
    let callNum = 0;
    mockAdminFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return facilityIdsChain([FACILITY_UUID]);
      if (callNum === 2) return singleChain({ ...DOMAIN_CONFIG, is_verified: false });
      return updateChain(null);
    });
    (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]);
    await POST(makeRequest());
    await flush();
    expect(sendOperatorNotification).toHaveBeenCalledTimes(1);
  });

  test('an unsent notification (mail not configured) is logged and the verification still succeeds', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (sendOperatorNotification as jest.Mock).mockResolvedValueOnce(false);
    setupOwnershipAndDomain(null);
    (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]);
    expect(await (await POST(makeRequest())).json()).toEqual({ verified: true });
    await flush();
    expect(warn).toHaveBeenCalledWith('[white-label/verify] operator notification not sent', { facilityId: FACILITY_UUID });
    warn.mockRestore();
  });

  test('a failing notification is logged and the verification still succeeds', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    (sendOperatorNotification as jest.Mock).mockRejectedValueOnce(new Error('provider down'));
    setupOwnershipAndDomain(null);
    (dns.resolveTxt as jest.Mock).mockResolvedValue([[DOMAIN_CONFIG.txt_record]]);
    expect(await (await POST(makeRequest())).json()).toEqual({ verified: true });
    await flush();
    expect(error).toHaveBeenCalledWith('[white-label/verify] operator notification failed', expect.objectContaining({ facilityId: FACILITY_UUID }));
    error.mockRestore();
  });
});
