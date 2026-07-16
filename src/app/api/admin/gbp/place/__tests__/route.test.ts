/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/admin/gbp/place
 * Key assertions:
 *   - Non-member → 403
 *   - GET: facility not found → 404
 *   - GET: external fetchPlaceDetails mocked
 *   - POST: saves gbp_place_id to facility_profiles
 *   - DB failure → 500
 *
 * 【2026年7月16日 恒久修正】facility_profiles は SELECT ポリシー（status='published' 限定）のみで
 * UPDATE 用 RLS ポリシーが存在せず、createServerSupabaseAuthClient（RLS適用）での .update() は
 * 拒否/0行になり GBP連携（Place ID保存・評価更新）が無音で死んでいた。書込を service role
 * （createServiceRoleClient）へ切替したため、このテストも facility_profiles への書込は
 * mockAdminFrom（service role）経由でモックする（読み取り・facility_members・gbp_audit_cache は
 * 従来通り mockAnonFrom＝RLS適用クライアント経由）。phantom success 防止（0行更新→404/ログ）の
 * 新規テストも追加した。
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));
jest.mock('@/lib/gbp', () => ({
  fetchPlaceDetails: jest.fn(() => Promise.resolve(null)),
  calculateGbpScore: jest.fn(() => ({ score: 80, items: [] })),
}));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID       = '33333333-3333-3333-3333-333333333333';

const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockAdminFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { fetchPlaceDetails } from '@/lib/gbp';

// 監査A2: getAdminFacilityIds は .select().eq().in() が直接配列Promiseを返す形（single()なし）。
function membershipSingle(members: { facility_id: string }[]) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn(() => Promise.resolve({ data: members })),
  };
}

// facility_profiles: select().eq().single()（読み取り・anon/authクライアント。変更なし）
function facilityProfileSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

// upsert chain (gbp_audit_cache・変更なし・anon/authクライアント経由のまま)
function upsertChain(error: unknown = null) {
  return {
    upsert: jest.fn(() => Promise.resolve({ error })),
  };
}

// facility_profiles への書込（service role・admin経由）チェーン。
// GET は `.update().eq().select('id')` を直接 await（Promise.allSettled 内・配列で返る）、
// POST は `.update().eq().select('id').maybeSingle()`（単一行）。両方の呼ばれ方に対応するため、
// select() の戻り値自体を thenable（Promise）にしつつ .maybeSingle() も生やす。
function adminUpdateChain(rowOrRows: unknown, error: unknown = null) {
  const arrayData = rowOrRows === null ? [] : (Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]);
  const singleData = Array.isArray(rowOrRows) ? (rowOrRows[0] ?? null) : rowOrRows;
  const selectResult: Promise<{ data: unknown[]; error: unknown }> & { maybeSingle?: jest.Mock } =
    Promise.resolve({ data: arrayData, error });
  selectResult.maybeSingle = jest.fn(() => Promise.resolve({ data: singleData, error }));
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        select: jest.fn(() => selectResult),
      }),
    }),
  };
}

const MEMBER_DATA = { facility_id: FACILITY_UUID };
const FACILITY_DATA = {
  gbp_place_id: null,
  name: 'テスト施設',
  description: null,
  phone: null,
  website_url: null,
  business_hours: null,
  main_photo_url: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  // 既定は書込成功（1行更新）。個別テストで上書きする。
  mockAdminFrom.mockReturnValue(adminUpdateChain({ id: FACILITY_UUID }));
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  (fetchPlaceDetails as jest.Mock).mockResolvedValue(null);
});

// ─── GET ──────────────────────────────────────────────────────────────────────

test('GET: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/place', { method: 'GET' }));
  expect(res.status).toBe(429);
});

test('GET: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/place', { method: 'GET' }));
  expect(res.status).toBe(401);
});

test('GET: 非管理者 → 403', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([]));
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/place', { method: 'GET' }));
  expect(res.status).toBe(403);
});

test('GET: 施設が見つからない → 404', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    return facilityProfileSingle(null);
  });
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/place', { method: 'GET' }));
  expect(res.status).toBe(404);
});

test('GET: gbp_place_id なし → 200 with placeData null', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return facilityProfileSingle(FACILITY_DATA);
    // if(placeData) ブロックに入らないため upsert/update は呼ばれない
    return upsertChain(null);
  });
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/place', { method: 'GET' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.placeData).toBeNull();
  expect(json.audit).toBeDefined();
});

// ─── POST ─────────────────────────────────────────────────────────────────────

test('POST: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_place_id: 'ChIJ123' }),
  }));
  expect(res.status).toBe(429);
});

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_place_id: 'ChIJ123' }),
  }));
  expect(res.status).toBe(401);
});

test('POST: 非管理者 → 403', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([]));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_place_id: 'ChIJ123' }),
  }));
  expect(res.status).toBe(403);
});

test('POST: DB失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA]));
  mockAdminFrom.mockReturnValue(adminUpdateChain(null, { message: 'DB error' }));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_place_id: 'ChIJ123' }),
  }));
  expect(res.status).toBe(500);
});

test('POST: facility_profiles 行が存在しない(0行更新) → 404（phantom success防止）', async () => {
  // service role は RLS をバイパスするため、facilityId に一致する行が無くてもエラーにならず
  // 0行更新のまま終わりうる。.select().maybeSingle() で実在確認し、無ければ 404 を返す。
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA]));
  mockAdminFrom.mockReturnValue(adminUpdateChain(null, null));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_place_id: 'ChIJ123' }),
  }));
  expect(res.status).toBe(404);
});

test('POST: 正常保存 → 200（service role 経由で facility_profiles を書込）', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA]));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_place_id: 'ChIJ123' }),
  }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

// ─── Additional coverage ──────────────────────────────────────────────────────

test('POST: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_place_id: 'ChIJ123' }),
  }));
  expect(res.status).toBe(403);
});

test('GET: CSRF エラー → 403（副作用前にクロスサイト誘発を遮断）', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/place', { method: 'GET' }));
  expect(res.status).toBe(403);
});

test('GET: rate limit params (20/60s)', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return facilityProfileSingle(FACILITY_DATA);
    return upsertChain(null);
  });
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await GET(new NextRequest('http://localhost/api/admin/gbp/place', { method: 'GET' }));
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(20);
  expect(call[3]).toBe(60_000);
});

test('POST: rate limit params (10/60s)', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA]));
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_place_id: 'ChIJ123' }),
  }));
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(10);
  expect(call[3]).toBe(60_000);
});

test('GET: レスポンスが { placeData, audit } 形式', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return facilityProfileSingle(FACILITY_DATA);
    return upsertChain(null);
  });
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/place', { method: 'GET' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect('placeData' in json).toBe(true);
  expect('audit' in json).toBe(true);
});

test('GET: fetchPlaceDetails がデータを返す → キャッシュ・評価更新（service role 経由）', async () => {
  const mockPlaceData = {
    name: 'テスト施設',
    rating: 4.5,
    user_ratings_total: 100,
    formatted_address: '東京都',
  };
  (fetchPlaceDetails as jest.Mock).mockResolvedValue(mockPlaceData);

  const facilityWithPlace = { ...FACILITY_DATA, gbp_place_id: 'ChIJ123' };

  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return facilityProfileSingle(facilityWithPlace);
    return upsertChain(null); // gbp_audit_cache upsert（anon/auth クライアントのまま）
  });
  // facility_profiles の google_rating 更新は admin（service role）経由
  mockAdminFrom.mockReturnValue(adminUpdateChain({ id: FACILITY_UUID }));

  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/place', { method: 'GET' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.placeData).toEqual(mockPlaceData);
});

test('GET: クエリの placeId は無視し、自店保存済みの gbp_place_id を使う（#2 詐称防止）', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return facilityProfileSingle({ ...FACILITY_DATA, gbp_place_id: 'ChIJ_facility' });
    return upsertChain(null);
  });

  (fetchPlaceDetails as jest.Mock).mockResolvedValue(null);

  const url = new URL('http://localhost/api/admin/gbp/place');
  // 攻撃者が CSRF 経由で任意 place_id を注入しても、
  url.searchParams.set('placeId', 'ChIJ_from_query');

  const res = await GET(new NextRequest(url.toString(), { method: 'GET' }));
  expect(res.status).toBe(200);
  // クエリではなく自店に保存済みの place_id が使われる（他店評価の詐称を防ぐ）。
  expect(fetchPlaceDetails).toHaveBeenCalledWith('ChIJ_facility');
  expect(fetchPlaceDetails).not.toHaveBeenCalledWith('ChIJ_from_query');
});

// ─── Branch coverage gaps ─────────────────────────────────────────────────────

test('GET: try ブロック内で例外 → 500', async () => {
  // membership lookup throws (e.g. supabase init error)
  mockAnonFrom.mockImplementation(() => {
    throw new Error('Unexpected crash');
  });
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/place', { method: 'GET' }));
  expect(res.status).toBe(500);
});

test('GET: cacheResult が rejected → 200 のまま (エラーログのみ)', async () => {
  const mockPlaceData = { name: 'X', rating: 4, user_ratings_total: 10 };
  (fetchPlaceDetails as jest.Mock).mockResolvedValue(mockPlaceData);
  const facilityWithPlace = { ...FACILITY_DATA, gbp_place_id: 'ChIJ123' };
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return facilityProfileSingle(facilityWithPlace);
    // gbp_audit_cache upsert が reject
    return { upsert: jest.fn(() => Promise.reject(new Error('upsert failed'))) };
  });
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/place', { method: 'GET' }));
  expect(res.status).toBe(200);
});

test('GET: cacheResult fulfilled but with error → 200 のまま', async () => {
  const mockPlaceData = { name: 'Y', rating: 4, user_ratings_total: 20 };
  (fetchPlaceDetails as jest.Mock).mockResolvedValue(mockPlaceData);
  const facilityWithPlace = { ...FACILITY_DATA, gbp_place_id: 'ChIJ456' };
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return facilityProfileSingle(facilityWithPlace);
    return upsertChain({ message: 'upsert err' });
  });
  mockAdminFrom.mockReturnValue(adminUpdateChain(null, { message: 'update err' }));
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/place', { method: 'GET' }));
  expect(res.status).toBe(200);
});

test('GET: ratingResult が rejected → 200 のまま', async () => {
  const mockPlaceData = { name: 'Z' };
  (fetchPlaceDetails as jest.Mock).mockResolvedValue(mockPlaceData);
  const facilityWithPlace = { ...FACILITY_DATA, gbp_place_id: 'ChIJ789' };
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return facilityProfileSingle(facilityWithPlace);
    return upsertChain(null);
  });
  // facility_profiles update（admin経由）が reject
  mockAdminFrom.mockReturnValue({
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        select: jest.fn(() => Promise.reject(new Error('update failed'))),
      }),
    }),
  });
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/place', { method: 'GET' }));
  expect(res.status).toBe(200);
});

test('GET: ratingResult が0行更新（facility_id不一致等）でも 200 のまま（phantom success防止・ログのみ）', async () => {
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const mockPlaceData = { name: 'ZeroRows', rating: 3.5, user_ratings_total: 5 };
  (fetchPlaceDetails as jest.Mock).mockResolvedValue(mockPlaceData);
  const facilityWithPlace = { ...FACILITY_DATA, gbp_place_id: 'ChIJZero' };
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return facilityProfileSingle(facilityWithPlace);
    return upsertChain(null);
  });
  // エラー無しだが更新0行（配列が空）＝ phantom success パターン
  mockAdminFrom.mockReturnValue(adminUpdateChain([], null));
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/place', { method: 'GET' }));
  expect(res.status).toBe(200);
  expect(consoleSpy).toHaveBeenCalledWith('[gbp/place] google_rating update failed', { facilityId: FACILITY_UUID });
  consoleSpy.mockRestore();
});

test('GET: placeData.rating/user_ratings_total が undefined でも安全に処理', async () => {
  const mockPlaceData = { name: 'A' }; // no rating, no user_ratings_total
  (fetchPlaceDetails as jest.Mock).mockResolvedValue(mockPlaceData);
  const facilityWithPlace = { ...FACILITY_DATA, gbp_place_id: 'ChIJabc' };
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return facilityProfileSingle(facilityWithPlace);
    return upsertChain(null);
  });
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/place', { method: 'GET' }));
  expect(res.status).toBe(200);
});

test('GET: x-forwarded-for あり', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return facilityProfileSingle(FACILITY_DATA);
    return upsertChain(null);
  });
  (checkRateLimit as jest.Mock).mockClear();
  const req = new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'GET',
    headers: { 'x-forwarded-for': '10.0.0.1, 1.2.3.4' },
  });
  await GET(req);
  expect((checkRateLimit as jest.Mock).mock.calls[0][1]).toBe('1.2.3.4');
});

test('POST: gbp_place_id に不正文字 → 400', async () => {
  mockAnonFrom.mockImplementation(() => membershipSingle([MEMBER_DATA]));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_place_id: 'has space!' }),
  }));
  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json.error).toContain('Place ID');
});

test('POST: gbp_place_id が文字列でない（数値）→ 400', async () => {
  mockAnonFrom.mockImplementation(() => membershipSingle([MEMBER_DATA]));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_place_id: 123 }),
  }));
  expect(res.status).toBe(400);
});

test('POST: gbp_place_id が300字超 → 400', async () => {
  mockAnonFrom.mockImplementation(() => membershipSingle([MEMBER_DATA]));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_place_id: 'A'.repeat(301) }),
  }));
  expect(res.status).toBe(400);
});

test('POST: gbp_cid に不正文字 → 400', async () => {
  mockAnonFrom.mockImplementation(() => membershipSingle([MEMBER_DATA]));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_place_id: 'ChIJ123', gbp_cid: 'bad cid!' }),
  }));
  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json.error).toContain('CID');
});

test('POST: gbp_cid が文字列でない（数値）→ 400', async () => {
  mockAnonFrom.mockImplementation(() => membershipSingle([MEMBER_DATA]));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_place_id: 'ChIJ123', gbp_cid: 999 }),
  }));
  expect(res.status).toBe(400);
});

// ─── 監査A2: 複数施設所有者の非決定的施設選択の根治確認 ────────────────────────

const FACILITY_UUID_2 = '44444444-4444-4444-4444-444444444444';

test('GET: 複数施設所有・facility_id未指定 → 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA, { facility_id: FACILITY_UUID_2 }]));
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/place', { method: 'GET' }));
  expect(res.status).toBe(400);
});

test('GET: 複数施設所有・所属していないfacility_id指定 → 403（越境防止）', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA, { facility_id: FACILITY_UUID_2 }]));
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/place?facility_id=99999999-9999-9999-9999-999999999999', { method: 'GET' }));
  expect(res.status).toBe(403);
});

test('POST: 複数施設所有・facility_id未指定 → 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA, { facility_id: FACILITY_UUID_2 }]));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_place_id: 'ChIJ123' }),
  }));
  expect(res.status).toBe(400);
});

test('POST: 複数施設所有・所属していないfacility_id指定 → 403（越境防止）', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA, { facility_id: FACILITY_UUID_2 }]));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_place_id: 'ChIJ123', facility_id: '99999999-9999-9999-9999-999999999999' }),
  }));
  expect(res.status).toBe(403);
});

test('POST: 不正なJSON body → catchでfacility_id未指定扱い（単一施設なら自動選択）', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA]));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  }));
  expect(res.status).toBe(200);
});

test('POST: gbp_place_id なし → クリア（null保存）', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA]));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/place', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gbp_place_id: '', gbp_cid: 'cid123' }),
  }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});
