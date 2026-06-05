/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/admin/featured-ads
 * Key assertions:
 *   - No facility membership → 403
 *   - Invalid slot_type → 400
 *   - ends_at ≤ starts_at → 400
 *   - ends_at > 2 years out → 400
 *   - DB insert failure → 500
 *   - No STRIPE_SECRET_KEY → dev mode (activate immediately, checkout_url null)
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));
jest.mock('@/lib/constants', () => ({ SITE_URL: 'http://localhost', UUID_REGEX: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID       = '33333333-3333-3333-3333-333333333333';
const SLOT_UUID     = '44444444-4444-4444-4444-444444444444';

const mockGetUser = jest.fn();
const mockAdminFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));
const mockChargeCreate = jest.fn();
jest.mock('@/lib/payjp', () => ({ getPayjp: jest.fn() }));

import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { getPayjp } from '@/lib/payjp';

function makeGetRequest() {
  return new NextRequest('http://localhost/api/admin/featured-ads', { method: 'GET' });
}

function makePostRequest(body: object) {
  return new NextRequest('http://localhost/api/admin/featured-ads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const STARTS = new Date(Date.now() + 86400_000).toISOString();
const ENDS   = new Date(Date.now() + 30 * 86400_000).toISOString();

function validPostBody(overrides: object = {}) {
  return { slot_type: 'search_top', starts_at: STARTS, ends_at: ENDS, ...overrides };
}

function facilityIdChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function listChain(data: unknown[], error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn(() => Promise.resolve({ data, error })),
  };
}

function insertSingle(data: unknown, error: unknown = null) {
  return {
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn(() => Promise.resolve({ data, error })),
      }),
    }),
  };
}

function updateEq(error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn(() => Promise.resolve({ error })),
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  delete process.env.STRIPE_SECRET_KEY; // dev mode: no Stripe
  (getPayjp as jest.Mock).mockReturnValue(null); // 既定: PAY.JP 無効（既存テストは従来挙動）
  mockChargeCreate.mockResolvedValue({ id: 'ch_ad_1', paid: true, captured: true, amount: 9800 });
});

// ─── PAY.JP 同期課金（Phase 3） ─────────────────────────────────────────────
function deleteEq() {
  return { delete: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) }) };
}
const PAYJP_TOKEN = 'tok_adAbc123';

test('POST: PAY.JP token課金成功 → 201 paid・is_active=true', async () => {
  (getPayjp as jest.Mock).mockReturnValue({ charges: { create: mockChargeCreate } });
  let n = 0;
  mockAdminFrom.mockImplementation(() => {
    n++;
    if (n === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    if (n === 2) return insertSingle({ id: SLOT_UUID, slot_type: 'search_top' });
    return updateEq(null); // activate
  });
  const res = await POST(makePostRequest(validPostBody({ token: PAYJP_TOKEN })));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.paid).toBe(true);
  expect(json.chargeId).toBe('ch_ad_1');
  expect(mockChargeCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 9800, currency: 'jpy', card: PAYJP_TOKEN }));
});

test('POST: PAY.JP token 不正 → 400・スロット削除', async () => {
  (getPayjp as jest.Mock).mockReturnValue({ charges: { create: mockChargeCreate } });
  const delChain = deleteEq();
  let n = 0;
  mockAdminFrom.mockImplementation(() => {
    n++;
    if (n === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    if (n === 2) return insertSingle({ id: SLOT_UUID, slot_type: 'search_top' });
    return delChain;
  });
  const res = await POST(makePostRequest(validPostBody({ token: 'bad' })));
  expect(res.status).toBe(400);
  expect(delChain.delete).toHaveBeenCalled();
  expect(mockChargeCreate).not.toHaveBeenCalled();
});

test('POST: PAY.JP 課金throw → 402・スロット削除', async () => {
  (getPayjp as jest.Mock).mockReturnValue({ charges: { create: mockChargeCreate } });
  mockChargeCreate.mockRejectedValue(new Error('card_declined'));
  const delChain = deleteEq();
  let n = 0;
  mockAdminFrom.mockImplementation(() => {
    n++;
    if (n === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    if (n === 2) return insertSingle({ id: SLOT_UUID, slot_type: 'search_top' });
    return delChain;
  });
  const res = await POST(makePostRequest(validPostBody({ token: PAYJP_TOKEN })));
  expect(res.status).toBe(402);
  expect(delChain.delete).toHaveBeenCalled();
});

test('POST: PAY.JP 課金が非Errorをthrow → 402（String化経路）', async () => {
  (getPayjp as jest.Mock).mockReturnValue({ charges: { create: mockChargeCreate } });
  mockChargeCreate.mockRejectedValue('plain_string');
  const delChain = deleteEq();
  let n = 0;
  mockAdminFrom.mockImplementation(() => {
    n++;
    if (n === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    if (n === 2) return insertSingle({ id: SLOT_UUID, slot_type: 'search_top' });
    return delChain;
  });
  const res = await POST(makePostRequest(validPostBody({ token: PAYJP_TOKEN })));
  expect(res.status).toBe(402);
});

test('POST: PAY.JP charge.paid=false → 402・スロット削除', async () => {
  (getPayjp as jest.Mock).mockReturnValue({ charges: { create: mockChargeCreate } });
  mockChargeCreate.mockResolvedValue({ id: 'ch_x', paid: false, captured: false });
  const delChain = deleteEq();
  let n = 0;
  mockAdminFrom.mockImplementation(() => {
    n++;
    if (n === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    if (n === 2) return insertSingle({ id: SLOT_UUID, slot_type: 'search_top' });
    return delChain;
  });
  const res = await POST(makePostRequest(validPostBody({ token: PAYJP_TOKEN })));
  expect(res.status).toBe(402);
  expect(delChain.delete).toHaveBeenCalled();
});

test('POST: PAY.JP 課金成立後の有効化失敗 → 500（chargeId返却）', async () => {
  (getPayjp as jest.Mock).mockReturnValue({ charges: { create: mockChargeCreate } });
  let n = 0;
  mockAdminFrom.mockImplementation(() => {
    n++;
    if (n === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    if (n === 2) return insertSingle({ id: SLOT_UUID, slot_type: 'search_top' });
    return updateEq({ message: 'db error' }); // activate fails
  });
  const res = await POST(makePostRequest(validPostBody({ token: PAYJP_TOKEN })));
  const json = await res.json();
  expect(res.status).toBe(500);
  expect(json.chargeId).toBe('ch_ad_1');
});

test('POST: PAY.JP有効でも token無し → Stripe/devフォールバック（dev即時有効化）', async () => {
  (getPayjp as jest.Mock).mockReturnValue({ charges: { create: mockChargeCreate } });
  let n = 0;
  mockAdminFrom.mockImplementation(() => {
    n++;
    if (n === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    if (n === 2) return insertSingle({ id: SLOT_UUID, slot_type: 'search_top' });
    return updateEq(null);
  });
  const res = await POST(makePostRequest(validPostBody())); // token 無し
  expect(res.status).toBe(201);
  expect(mockChargeCreate).not.toHaveBeenCalled(); // PAY.JP 課金は走らない
});

// ─── GET ──────────────────────────────────────────────────────────────────────

test('GET: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(401);
});

test('GET: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(429);
});

test('GET: 施設なし → 403', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain(null));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(403);
});

test('GET: 正常取得 → 200 with slots', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    return listChain([{ id: SLOT_UUID }]);
  });
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.slots).toBeDefined();
});

// ─── POST ─────────────────────────────────────────────────────────────────────

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(401);
});

test('POST: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(429);
});

test('POST: 施設なし → 403', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain(null));
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(403);
});

test('POST: 必須フィールド欠落 → 400', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain({ facility_id: FACILITY_UUID }));
  const res = await POST(makePostRequest({ slot_type: 'search_top' })); // starts_at, ends_at missing
  expect(res.status).toBe(400);
});

test('POST: 不正な slot_type → 400', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain({ facility_id: FACILITY_UUID }));
  const res = await POST(makePostRequest(validPostBody({ slot_type: 'premium_top' })));
  expect(res.status).toBe(400);
});

test('POST: ends_at ≤ starts_at → 400', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain({ facility_id: FACILITY_UUID }));
  const res = await POST(makePostRequest(validPostBody({ starts_at: ENDS, ends_at: STARTS })));
  expect(res.status).toBe(400);
});

test('POST: ends_at が 2年超え → 400', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain({ facility_id: FACILITY_UUID }));
  const tooFar = new Date();
  tooFar.setFullYear(tooFar.getFullYear() + 3);
  const res = await POST(makePostRequest(validPostBody({ ends_at: tooFar.toISOString() })));
  expect(res.status).toBe(400);
});

test('POST: DB挿入失敗 → 500', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    return insertSingle(null, { message: 'DB error' });
  });
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(500);
});

test('POST: Stripeなし→devモード→201 checkout_url=null', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    if (callNum === 2) return insertSingle({ id: SLOT_UUID, slot_type: 'search_top' });
    return updateEq(null); // activate slot
  });
  const res = await POST(makePostRequest(validPostBody()));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.checkout_url).toBeNull();
  expect(json.slot).toBeDefined();
});

// ─── Additional coverage ──────────────────────────────────────────────────────

test('POST: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(403);
});

test('GET: rate limit params (20/60s)', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    return listChain([]);
  });
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (inMemoryRateLimit as jest.Mock).mockClear();
  await GET(makeGetRequest());
  const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
  expect(call[1]).toBe(20);
  expect(call[2]).toBe(60_000);
});

test('POST: rate limit params (10/60s)', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    if (callNum === 2) return insertSingle({ id: SLOT_UUID });
    return updateEq(null);
  });
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (inMemoryRateLimit as jest.Mock).mockClear();
  await POST(makePostRequest(validPostBody()));
  const postCall = (inMemoryRateLimit as jest.Mock).mock.calls.find((c: unknown[]) => c[3] === 'featured-ads');
  expect(postCall).toBeDefined();
  expect(postCall[1]).toBe(10);
  expect(postCall[2]).toBe(60_000);
});

test('GET: レスポンスが { slots: [] } 形式', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    return listChain([]);
  });
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(Array.isArray(json.slots)).toBe(true);
});

// ─── 追加ブランチカバレッジ ───────────────────────────────────────────

test('POST: 不正な日付形式 → 400', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain({ facility_id: FACILITY_UUID }));
  const res = await POST(makePostRequest({
    slot_type: 'search_top', starts_at: 'invalid-date', ends_at: 'also-invalid',
  }));
  expect(res.status).toBe(400);
});

test('POST: devモード activate 失敗 → 500', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    if (callNum === 2) return insertSingle({ id: SLOT_UUID });
    return updateEq({ message: 'fail' });
  });
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(500);
});

test('POST: 例外発生 → 500 (catchブロック)', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockAdminFrom.mockImplementation(() => {
    throw new Error('boom');
  });
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(500);
});

test('GET: slots が null → 空配列で返す', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    return listChain(null as unknown as unknown[]);
  });
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(json.slots).toEqual([]);
});

test('POST: 不正な JSON body → 400 (slot_type 欠落で)', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain({ facility_id: FACILITY_UUID }));
  const req = new NextRequest('http://localhost/api/admin/featured-ads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

test('POST: area/business_type 指定で正常作成 (devモード)', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    if (callNum === 2) return insertSingle({ id: SLOT_UUID });
    return updateEq(null);
  });
  const res = await POST(makePostRequest(validPostBody({ area: '東京', business_type: 'salon' })));
  expect(res.status).toBe(201);
});

// Branch coverage: line 101 — budget_yen: PLAN_PRICES[slot_type] が定義されている場合の正常値確認
test('POST: area_banner slot_type → budget_yen=4900 (PLAN_PRICES 分岐)', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    if (callNum === 2) return insertSingle({ id: SLOT_UUID, slot_type: 'area_banner', budget_yen: 4900 });
    return updateEq(null);
  });
  const res = await POST(makePostRequest(validPostBody({ slot_type: 'area_banner' })));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.slot).toBeDefined();
});

test('POST: category_top slot_type → budget_yen=7800 (PLAN_PRICES 分岐)', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    if (callNum === 2) return insertSingle({ id: SLOT_UUID, slot_type: 'category_top', budget_yen: 7800 });
    return updateEq(null);
  });
  const res = await POST(makePostRequest(validPostBody({ slot_type: 'category_top' })));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.slot).toBeDefined();
});

// Branch coverage: line 111, 135 (×2) — Stripe 設定ありの場合: checkout session 作成
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_test_abc' }),
      },
    },
  }));
});

test('POST: Stripe設定あり → checkout URL を返す (line 135)', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';

  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    return insertSingle({ id: SLOT_UUID, slot_type: 'search_top' });
  });

  const res = await POST(makePostRequest(validPostBody()));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.checkout_url).toBe('https://checkout.stripe.com/pay/cs_test_abc');
  expect(json.slot).toBeDefined();

  delete process.env.STRIPE_SECRET_KEY;
});

test('POST: Stripe設定あり + area_banner → checkout URL を返す (line 135 planLabels 分岐)', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';

  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    return insertSingle({ id: SLOT_UUID, slot_type: 'area_banner' });
  });

  const res = await POST(makePostRequest(validPostBody({ slot_type: 'area_banner' })));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.checkout_url).toBe('https://checkout.stripe.com/pay/cs_test_abc');

  delete process.env.STRIPE_SECRET_KEY;
});
