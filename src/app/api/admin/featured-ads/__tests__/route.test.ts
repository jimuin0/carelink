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

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
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

import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

function makeGetRequest(facilityId: string = FACILITY_UUID) {
  return new NextRequest(`http://localhost/api/admin/featured-ads?facility_id=${facilityId}`, { method: 'GET' });
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
  return { facility_id: FACILITY_UUID, slot_type: 'search_top', starts_at: STARTS, ends_at: ENDS, ...overrides };
}

/** verifyFacilityMembership は .maybeSingle() で終わる */
function facilityIdChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error: null })),
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
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  delete process.env.STRIPE_SECRET_KEY; // dev mode: no Stripe
  delete process.env.VERCEL_ENV; // 既定は非本番（fail-closed 判定は VERCEL_ENV=production のみ）
});

// ─── GET ──────────────────────────────────────────────────────────────────────

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

test('GET: facility_id クエリパラメータなし → 400', async () => {
  const res = await GET(new NextRequest('http://localhost/api/admin/featured-ads', { method: 'GET' }));
  expect(res.status).toBe(400);
});

test('GET: 施設メンバーシップなし → 403', async () => {
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
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(429);
});

test('POST: facility_id なし → 400', async () => {
  const { facility_id: _omit, ...bodyWithoutFacility } = validPostBody() as Record<string, unknown>;
  const res = await POST(makePostRequest(bodyWithoutFacility));
  expect(res.status).toBe(400);
});

test('POST: 施設メンバーシップなし → 403', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain(null));
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(403);
});

test('POST: 必須フィールド欠落 (starts_at/ends_at なし) → 400', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain({ facility_id: FACILITY_UUID }));
  const res = await POST(makePostRequest({ facility_id: FACILITY_UUID, slot_type: 'search_top' })); // starts_at, ends_at missing
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

// 【恒久根治・金銭仕様確定 2026年7月16日】真の本番(VERCEL_ENV=production)で STRIPE_SECRET_KEY
// が未設定の場合、決済なしで広告枠を無料アクティブ化する抜け穴を fail-closed(500) に根治した。
// 判定源は NODE_ENV ではなく VERCEL_ENV（NODE_ENV は Vercel Preview でも 'production' になり
// Preview まで巻き込むため）。開発/デモ(VERCEL_ENV≠production)の即時有効化は維持する。
test('POST: 本番(VERCEL_ENV=production)でSTRIPE_SECRET_KEY未設定 → 500 fail-closed（無料アクティブ化しない）', async () => {
  const originalVercelEnv = process.env.VERCEL_ENV;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  process.env.VERCEL_ENV = 'production';
  try {
    // テーブル名ベースでディスパッチする（audit_logs への fire-and-forget 書き込みが
    // featured_slots とは独立に発生するため、callNum の呼び出し順序に依存しない）。
    const activateSpy = jest.fn();
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'facility_members') return facilityIdChain({ facility_id: FACILITY_UUID });
      if (table === 'featured_slots') {
        return {
          insert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn(() => Promise.resolve({ data: { id: SLOT_UUID, slot_type: 'search_top' }, error: null })),
            }),
          }),
          update: jest.fn((payload: unknown) => {
            activateSpy(payload);
            return { eq: jest.fn(() => Promise.resolve({ error: null })) };
          }),
        };
      }
      if (table === 'audit_logs') return { insert: jest.fn().mockResolvedValue({ error: null }) };
      return {};
    });
    const res = await POST(makePostRequest(validPostBody()));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.error).toBeDefined();
    // is_active を true にする update 呼び出しに到達していないこと（無料化が発生していない）。
    expect(activateSpy).not.toHaveBeenCalled();
  } finally {
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
  }
});

// Preview デプロイ(VERCEL_ENV=preview)は開発扱い＝即時アクティブ化を維持する（NODE_ENV
// ベースだと Preview の NODE_ENV=production で誤って fail-closed になっていた盲点の回帰防止）。
test('POST: Preview(VERCEL_ENV=preview)でSTRIPE_SECRET_KEY未設定 → 201 即時有効化（fail-closedしない）', async () => {
  const originalVercelEnv = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = 'preview';
  try {
    let callNum = 0;
    mockAdminFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
      if (callNum === 2) return insertSingle({ id: SLOT_UUID, slot_type: 'search_top' });
      return updateEq(null);
    });
    const res = await POST(makePostRequest(validPostBody()));
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.checkout_url).toBeNull();
  } finally {
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
  }
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
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await GET(makeGetRequest());
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(20);
  expect(call[3]).toBe(60_000);
});

test('POST: rate limit params (10/60s)', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    if (callNum === 2) return insertSingle({ id: SLOT_UUID });
    return updateEq(null);
  });
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await POST(makePostRequest(validPostBody()));
  const postCall = (checkRateLimit as jest.Mock).mock.calls.find((c: unknown[]) => c[4] === 'featured-ads');
  expect(postCall).toBeDefined();
  expect(postCall[2]).toBe(10);
  expect(postCall[3]).toBe(60_000);
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
    facility_id: FACILITY_UUID, slot_type: 'search_top', starts_at: 'invalid-date', ends_at: 'also-invalid',
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

// Branch coverage: L50 — featured_slots クエリ失敗 → 500
test('GET: slotsErr → 500 (L50 slotsErr 分岐)', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    return listChain([], { message: 'DB error' });
  });
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(500);
  const json = await res.json();
  expect(json.error).toBeDefined();
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
