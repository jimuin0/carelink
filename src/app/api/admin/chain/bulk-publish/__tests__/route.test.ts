/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/chain/bulk-publish
 * Key assertions:
 *   - Partial facility ownership → 403 (all-or-nothing check)
 *   - facility_ids > 50 → 400
 *   - is_published not boolean → 400
 *   - DB update failure → 500
 *   - Success → 200
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const USER_ID    = '33333333-3333-3333-3333-333333333333';
const FACILITY_A = '11111111-1111-1111-1111-111111111111';
const FACILITY_B = '22222222-2222-2222-2222-222222222222';

const mockGetUser = jest.fn();
const mockAdminFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/admin/chain/bulk-publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: object = {}) {
  return {
    facility_ids: [FACILITY_A, FACILITY_B],
    is_published: true,
    ...overrides,
  };
}

function membershipChain(data: unknown[]) {
  const finalIn = jest.fn(() => Promise.resolve({ data, error: null }));
  const firstIn = jest.fn().mockReturnValue({ in: finalIn });
  return {
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({ in: firstIn }),
    }),
  };
}

// 公開ゲート(checkPublishReadiness)の count クエリ用 thenable。
// facility_menus は .select().eq().or()、photos は .select().eq()、staff は .select().eq().eq()。
// facility_profiles は【2つの用途で読まれる】ので、update と select の両方を持つ。
// 公開ガードが地域（prefecture / city）も必須条件に加えたため（facility-publish-gate.ts）、
// ガードは .select('prefecture, city').eq('id',…).single() を呼び、route 本体はその後
// .update().eq() で status を書く。update だけのスタブに倒すと
// 「admin.from(...).select is not a function」でガード側が落ちる。
// 公開ゲートの地域読み取りだけを満たす部分スタブ。update スパイを温存したいテスト用。
function profileSelectOnly(prefecture = '大阪府', city = '堺市') {
  return {
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: { prefecture, city }, error: null })),
      })),
    })),
  };
}

function facilityProfileChain(opts: {
  updateError?: unknown;
  prefecture?: string | null;
  city?: string | null;
  profileError?: unknown;
} = {}) {
  // 既定は「地域が入っている」＝ガードの地域条件は充足。個々のテストが検証したいのは
  // メニュー/写真/スタッフの条件なので、地域で落ちない既定にしておく。
  const prefecture = opts.prefecture === undefined ? '大阪府' : opts.prefecture;
  const city = opts.city === undefined ? '堺市' : opts.city;
  return {
    // 一括公開は .update().in(ids) で複数施設をまとめて書く（単一施設の settings は .eq）。
    update: jest.fn().mockReturnValue({
      in: jest.fn(() => Promise.resolve({ error: opts.updateError ?? null })),
    }),
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        single: jest.fn(() =>
          Promise.resolve({
            data: opts.profileError ? null : { prefecture, city },
            error: opts.profileError ?? null,
          }),
        ),
      })),
    })),
  };
}

function countChain(count: number | null, error: unknown = null) {
  const obj: Record<string, unknown> = {};
  obj.select = jest.fn(() => obj);
  obj.eq = jest.fn(() => obj);
  obj.or = jest.fn(() => obj);
  obj.then = (resolve: (v: { count: number | null; error: unknown }) => unknown) => resolve({ count, error });
  return obj;
}

// 公開ゲートの充足度を施設ごとに指定できるモック。counts はテーブル名→件数。
function setupReadiness(opts: {
  memberships?: unknown[];
  menu?: number | null;
  photo?: number | null;
  staff?: number | null;
  countError?: unknown;
  updateError?: unknown;
  prefecture?: string | null;
  city?: string | null;
} = {}) {
  const memberships = opts.memberships ?? [{ facility_id: FACILITY_A }, { facility_id: FACILITY_B }];
  const m = opts.menu === undefined ? 1 : opts.menu;
  const p = opts.photo === undefined ? 1 : opts.photo;
  const s = opts.staff === undefined ? 1 : opts.staff;
  const e = opts.countError ?? null;
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'facility_members') return membershipChain(memberships);
    if (table === 'facility_menus') return countChain(m, e);
    if (table === 'facility_photos') return countChain(p, e);
    if (table === 'staff_profiles') return countChain(s, e);
    return facilityProfileChain({
      updateError: opts.updateError ?? null,
      prefecture: opts.prefecture,
      city: opts.city,
      profileError: e,
    });
  });
}

function setupSuccess() {
  setupReadiness({ menu: 1, photo: 1, staff: 1 });
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(401);
});

test('POST: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(429);
});

test('POST: facility_ids が空 → 400', async () => {
  const res = await POST(makeRequest({ facility_ids: [], is_published: true }));
  expect(res.status).toBe(400);
});

test('POST: is_published が文字列 → 400', async () => {
  const res = await POST(makeRequest(validBody({ is_published: 'true' })));
  expect(res.status).toBe(400);
});

test('POST: is_published が欠落 → 400', async () => {
  const res = await POST(makeRequest({ facility_ids: [FACILITY_A] }));
  expect(res.status).toBe(400);
});

test('POST: facility_ids が 51件 → 400', async () => {
  const ids = Array.from({ length: 51 }, (_, i) =>
    `${String(i).padStart(8, '0')}-0000-1000-8000-000000000000`
  );
  const res = await POST(makeRequest(validBody({ facility_ids: ids })));
  expect(res.status).toBe(400);
});

test('POST: facility_ids に不正なUUID → 400', async () => {
  const res = await POST(makeRequest(validBody({ facility_ids: ['not-a-uuid'] })));
  expect(res.status).toBe(400);
});

test('POST: 一部施設が未認可 → 403', async () => {
  mockAdminFrom.mockImplementation(() =>
    membershipChain([{ facility_id: FACILITY_A }]) // only one of two
  );
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(403);
});

test('POST: DB更新失敗 → 500', async () => {
  // 公開ゲートは充足させ、facility_profiles の update で失敗させる
  setupReadiness({ menu: 1, photo: 1, staff: 1, updateError: { message: 'DB error' } });
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(500);
});

// ─── BP-1: 公開ゲート（未完成施設は公開対象から除外して skipped に返す）──────────
test('POST: 必須項目未充足の施設は公開対象から除外され skipped に返る', async () => {
  // メニュー0件 → 両施設とも未充足 → 公開されず updated:0・skipped:2
  setupReadiness({ menu: 0, photo: 1, staff: 1 });
  const res = await POST(makeRequest(validBody({ is_published: true })));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.updated).toBe(0);
  expect(json.skipped).toHaveLength(2);
  expect(json.skipped[0].missing).toContain('メニューを1つ以上登録してください');
});

test('POST: 公開ゲートの count 取得エラー → 500', async () => {
  setupReadiness({ countError: { message: 'count failed' } });
  const res = await POST(makeRequest(validBody({ is_published: true })));
  expect(res.status).toBe(500);
});

test('POST: 非公開化(draft)は公開ゲートを通さず全件更新', async () => {
  setupReadiness({ menu: 0, photo: 0, staff: 0 }); // 未充足でも draft 化は無関係
  const res = await POST(makeRequest(validBody({ is_published: false })));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.updated).toBe(2);
  expect(json.skipped).toHaveLength(0);
});

test('POST: 公開に一括変更 → 200', async () => {
  setupSuccess();
  const res = await POST(makeRequest(validBody({ is_published: true })));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
  expect(json.updated).toBe(2);
});

test('POST: 非公開に一括変更 → 200', async () => {
  setupSuccess();
  const res = await POST(makeRequest(validBody({ is_published: false })));
  expect(res.status).toBe(200);
});

test('POST: 公開は status=published を書き込む（is_published 列は存在しない・回帰防止）', async () => {
  const updateSpy = jest.fn().mockReturnValue({ in: jest.fn(() => Promise.resolve({ error: null })) });
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'facility_members') {
      return membershipChain([{ facility_id: FACILITY_A }, { facility_id: FACILITY_B }]);
    }
    if (table === 'facility_menus' || table === 'facility_photos' || table === 'staff_profiles') {
      return countChain(1); // 公開ゲート充足
    }
    // 公開ゲートは facility_profiles から地域も読む。update スパイは検証対象なので温存しつつ、
    // select を足してゲートの地域条件も充足させる（ここで見たいのは書き込む列名だけ）。
    return { update: updateSpy, ...profileSelectOnly() };
  });
  await POST(makeRequest(validBody({ is_published: true })));
  const payload = updateSpy.mock.calls[0][0];
  expect(payload.status).toBe('published');
  expect(payload).not.toHaveProperty('is_published');
});

test('POST: 非公開は status=draft を書き込む（既存 settings 単体トグルと一貫・回帰防止）', async () => {
  const updateSpy = jest.fn().mockReturnValue({ in: jest.fn(() => Promise.resolve({ error: null })) });
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'facility_members') {
      return membershipChain([{ facility_id: FACILITY_A }, { facility_id: FACILITY_B }]);
    }
    return { update: updateSpy };
  });
  await POST(makeRequest(validBody({ is_published: false })));
  const payload = updateSpy.mock.calls[0][0];
  expect(payload.status).toBe('draft');
  expect(payload).not.toHaveProperty('is_published');
});

test('POST: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(403);
});

test('POST: writeAuditLog が呼ばれる', async () => {
  setupSuccess();
  const { writeAuditLog } = require('@/lib/audit-logger');
  await POST(makeRequest(validBody()));
  await new Promise(r => setTimeout(r, 10));
  expect(writeAuditLog).toHaveBeenCalled();
});

test('POST: レートリミット params (10/60s)', async () => {
  setupSuccess();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await POST(makeRequest(validBody()));
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(10);
  expect(call[3]).toBe(60_000);
});

test('POST: レスポンスが { ok: true, updated: N } 形式', async () => {
  setupSuccess();
  const res = await POST(makeRequest(validBody()));
  const json = await res.json();
  expect(json.ok).toBe(true);
  expect(typeof json.updated).toBe('number');
});

test('POST: 不正なJSON → 400', async () => {
  const req = new NextRequest('http://localhost/api/admin/chain/bulk-publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

test('POST: facility_ids が文字列 (非配列) → 400', async () => {
  const res = await POST(makeRequest({ facility_ids: 'not-array' as any, is_published: true }));
  expect(res.status).toBe(400);
});

test('POST: memberships が null → 403', async () => {
  // membership query returns data: null
  mockAdminFrom.mockImplementation(() => {
    const finalIn = jest.fn(() => Promise.resolve({ data: null, error: null }));
    const firstIn = jest.fn().mockReturnValue({ in: finalIn });
    return {
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ in: firstIn }),
      }),
    };
  });
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(403);
});

test('POST: facility_ids が 50件 (上限ぴったり) → 200', async () => {
  const ids = Array.from({ length: 50 }, (_, i) =>
    `${String(i + 1).padStart(8, '0')}-0000-4000-8000-000000000001`
  );
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'facility_members') {
      return membershipChain(ids.map(id => ({ facility_id: id })));
    }
    if (table === 'facility_menus' || table === 'facility_photos' || table === 'staff_profiles') {
      return countChain(1);
    }
    return facilityProfileChain();
  });
  const res = await POST(makeRequest({ facility_ids: ids, is_published: true }));
  expect(res.status).toBe(200);
});
