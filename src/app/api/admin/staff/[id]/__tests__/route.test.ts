/**
 * @jest-environment node
 *
 * Tests for PATCH /api/admin/staff/[id]
 * Key assertions:
 *   - facility_id in UPDATE WHERE (defence-in-depth: prevents cross-facility staff edit)
 *   - instagram_url: must be valid URL or empty string
 *   - specialties: max 20 items
 *   - facility_id query param required (missing → 401)
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ua: 'test', ip: '127.0.0.1' })),
}));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const STAFF_UUID = '11111111-1111-1111-1111-111111111111';
const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const mockAdminFrom = jest.fn();
const mockAnonFrom = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { PATCH } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

const VALID_BODY = { name: 'テストスタッフ' };

function makeRequest(body: object = VALID_BODY, facilityId: string | null = FACILITY_UUID) {
  const url = new URL(`http://localhost/api/admin/staff/${STAFF_UUID}`);
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeProps(id = STAFF_UUID) {
  return { params: Promise.resolve({ id }) };
}

function memberChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function updateChain(data: unknown, error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            maybeSingle: jest.fn(() => Promise.resolve({ data, error })),
          }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── Security guards ──────────────────────────────────────────────────────────

test('未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(401);
});

test('レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(429);
});

test('不正なUUID (staff_id) → 400', async () => {
  const res = await PATCH(makeRequest(), makeProps('not-uuid'));
  expect(res.status).toBe(400);
});

test('facility_id クエリパラメータなし → 401', async () => {
  const res = await PATCH(makeRequest(VALID_BODY, null), makeProps());
  expect(res.status).toBe(401);
});

test('不正なfacility_id形式 → 401', async () => {
  const res = await PATCH(makeRequest(VALID_BODY, 'not-uuid'), makeProps());
  expect(res.status).toBe(401);
});

test('他施設のメンバー以外 → 401 (IDOR防止)', async () => {
  mockAnonFrom.mockReturnValue(memberChain(null)); // not a member
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(401);
});

// ─── Schema validation ────────────────────────────────────────────────────────

test('name が空文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest({ name: '' }), makeProps());
  expect(res.status).toBe(400);
});

test('instagram_url が無効URL → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest({ name: 'test', instagram_url: 'not-a-url' }), makeProps());
  expect(res.status).toBe(400);
});

test('instagram_url が空文字 → 許可 (optional)', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain({ id: STAFF_UUID, name: 'test' }));
  const res = await PATCH(makeRequest({ name: 'test', instagram_url: '' }), makeProps());
  expect(res.status).toBe(200);
});

test('is_active=false（休止）指定 → 200 かつ更新に is_active が含まれる', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  let updateArgs: Record<string, unknown> | undefined;
  mockAdminFrom.mockReturnValue({
    update: jest.fn((fields: Record<string, unknown>) => {
      updateArgs = fields;
      return { eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: STAFF_UUID, name: 'test', is_active: false }, error: null }) }) }) }) };
    }),
  });
  const res = await PATCH(makeRequest({ name: 'test', is_active: false }), makeProps());
  expect(res.status).toBe(200);
  expect(updateArgs?.is_active).toBe(false);
});

test('specialties が21件 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest({ name: 'test', specialties: Array(21).fill('spec') }), makeProps());
  expect(res.status).toBe(400);
});

test('years_experience が 100 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest({ name: 'test', years_experience: 100 }), makeProps());
  expect(res.status).toBe(400);
});

// ─── nomination_fee（指名料・金銭値）バリデーション ──────────────────────────────

test('nomination_fee が 100000 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest({ name: 'test', nomination_fee: 100000 }), makeProps());
  expect(res.status).toBe(400);
});

test('nomination_fee が 負値(-1) → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest({ name: 'test', nomination_fee: -1 }), makeProps());
  expect(res.status).toBe(400);
});

test('nomination_fee が 非数(文字列) → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest({ name: 'test', nomination_fee: 'abc' }), makeProps());
  expect(res.status).toBe(400);
});

test('nomination_fee が 0 → 200 かつ更新に nomination_fee=0 が含まれる', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  let updateArgs: Record<string, unknown> | undefined;
  mockAdminFrom.mockReturnValue({
    update: jest.fn((fields: Record<string, unknown>) => {
      updateArgs = fields;
      return { eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: STAFF_UUID, name: 'test', nomination_fee: 0 }, error: null }) }) }) }) };
    }),
  });
  const res = await PATCH(makeRequest({ name: 'test', nomination_fee: 0 }), makeProps());
  expect(res.status).toBe(200);
  expect(updateArgs?.nomination_fee).toBe(0);
});

test('nomination_fee が 99999 → 200 かつ更新に nomination_fee=99999 が含まれる', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  let updateArgs: Record<string, unknown> | undefined;
  mockAdminFrom.mockReturnValue({
    update: jest.fn((fields: Record<string, unknown>) => {
      updateArgs = fields;
      return { eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: STAFF_UUID, name: 'test', nomination_fee: 99999 }, error: null }) }) }) }) };
    }),
  });
  const res = await PATCH(makeRequest({ name: 'test', nomination_fee: 99999 }), makeProps());
  expect(res.status).toBe(200);
  expect(updateArgs?.nomination_fee).toBe(99999);
});

test('nomination_fee 未指定 → 200 かつ更新に nomination_fee=0（デフォルト）が含まれる', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  let updateArgs: Record<string, unknown> | undefined;
  mockAdminFrom.mockReturnValue({
    update: jest.fn((fields: Record<string, unknown>) => {
      updateArgs = fields;
      return { eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: STAFF_UUID, name: 'test' }, error: null }) }) }) }) };
    }),
  });
  const res = await PATCH(makeRequest({ name: 'test' }), makeProps());
  expect(res.status).toBe(200);
  expect(updateArgs?.nomination_fee).toBe(0);
});

// ─── Defence-in-depth: facility_id in WHERE ──────────────────────────────────

test('UPDATEのWHEREにfacility_idが含まれる', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const innerEq = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      maybeSingle: jest.fn(() => Promise.resolve({ data: { id: STAFF_UUID, name: 'updated' }, error: null })),
    }),
  });
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  const updateMock = jest.fn().mockReturnValue({ eq: outerEq });
  mockAdminFrom.mockReturnValue({ update: updateMock });

  await PATCH(makeRequest({ name: 'updated' }), makeProps());

  expect(outerEq).toHaveBeenCalledWith('id', STAFF_UUID);
  expect(innerEq).toHaveBeenCalledWith('facility_id', FACILITY_UUID);
});

// ─── DB error paths ───────────────────────────────────────────────────────────

test('UPDATE DB失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain(null, { message: 'DB error' }));
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(500);
});

test('スタッフが見つからない → 404', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain(null)); // data is null, no error
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(404);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test('正常更新 → 200 with staff data', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain({ id: STAFF_UUID, name: 'テストスタッフ', facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest({ name: 'テストスタッフ', years_experience: 5, specialties: ['眉毛', 'まつ毛'] }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.staff).toBeDefined();
});

test('CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(403);
});

test('レートリミット params (20/60s)', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain({ id: STAFF_UUID, name: 'test' }));
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await PATCH(makeRequest(), makeProps());
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(20);
  expect(call[3]).toBe(60_000);
});

test('writeAuditLog が呼ばれる', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain({ id: STAFF_UUID, name: 'test' }));
  const { writeAuditLog } = require('@/lib/audit-logger');
  await PATCH(makeRequest({ name: 'test' }), makeProps());
  await new Promise(r => setTimeout(r, 10));
  expect(writeAuditLog).toHaveBeenCalled();
});

test('レスポンスが { staff: ... } 形式', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain({ id: STAFF_UUID, name: 'テスト' }));
  const res = await PATCH(makeRequest({ name: 'テスト' }), makeProps());
  const json = await res.json();
  expect(json.staff.id).toBe(STAFF_UUID);
});

// ─── 担当メニュー(menu_staff)同期（2026年7月15日 HPB準拠仕様） ─────────────────
describe('担当メニュー(menu_staff)同期', () => {
  // zod4 の z.string().uuid() は RFC のバリアントニブルを検証するため、有効なUUID
  // （バリアント位が 8/9/a/b）を使う（4444.. 等は variant=4 で invalid になる）。
  const MENU_A = '423e4567-e89b-12d3-a456-426614174001';
  const MENU_B = '523e4567-e89b-12d3-a456-426614174002';

  // await 可能な（thenable）クエリ結果を返すチェーン。任意のメソッド呼び出しで自身を返し、
  // .then で result に解決する。facility_menus 検証・menu_staff delete の両方に使える。
  function thenableChain(result: unknown) {
    const chain: Record<string, unknown> = {};
    const handler = jest.fn(() => chain);
    chain.select = handler;
    chain.in = handler;
    chain.eq = handler;
    chain.delete = handler;
    chain.then = Promise.resolve(result).then.bind(Promise.resolve(result));
    return chain;
  }

  // 表を切り替える admin.from モックを組む。facility_menus 検証・staff_profiles 更新・
  // menu_staff delete/insert をそれぞれ差し替えられるようにする。
  function setupAdmin(opts: {
    menuValidation?: unknown;
    staffUpdate?: { data: unknown; error?: unknown };
    deleteResult?: unknown;
    insertResult?: unknown;
    insertSpy?: jest.Mock;
  }) {
    const staffUpdate = opts.staffUpdate ?? { data: { id: STAFF_UUID, name: 'test' }, error: null };
    const insertSpy = opts.insertSpy ?? jest.fn(() => Promise.resolve(opts.insertResult ?? { error: null }));
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'facility_menus') return thenableChain(opts.menuValidation ?? { data: [{ id: MENU_A }, { id: MENU_B }], error: null });
      if (table === 'staff_profiles') {
        return {
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                select: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn(() => Promise.resolve(staffUpdate)),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'menu_staff') {
        return {
          delete: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve(opts.deleteResult ?? { error: null })) })),
          insert: insertSpy,
        };
      }
      return {};
    });
    return { insertSpy };
  }

  test('menu_ids 指定（非空・自施設メニュー）→ 200・delete→insert される', async () => {
    mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
    const { insertSpy } = setupAdmin({});
    const res = await PATCH(makeRequest({ name: 'test', menu_ids: [MENU_A, MENU_B] }), makeProps());
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledWith([
      { menu_id: MENU_A, staff_id: STAFF_UUID },
      { menu_id: MENU_B, staff_id: STAFF_UUID },
    ]);
  });

  test('menu_ids 空配列（担当制解除）→ 200・delete のみ・insert は呼ばれない', async () => {
    mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
    const { insertSpy } = setupAdmin({});
    const res = await PATCH(makeRequest({ name: 'test', menu_ids: [] }), makeProps());
    expect(res.status).toBe(200);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  test('他施設メニューID注入 → 400（fail-closed・staff更新前に弾く）', async () => {
    mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
    // 検証クエリは MENU_A のみ返す（MENU_B は自施設に無い＝注入）
    setupAdmin({ menuValidation: { data: [{ id: MENU_A }], error: null } });
    const res = await PATCH(makeRequest({ name: 'test', menu_ids: [MENU_A, MENU_B] }), makeProps());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('担当メニュー');
  });

  test('facility_menus 検証クエリ失敗 → 500', async () => {
    mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
    setupAdmin({ menuValidation: { data: null, error: { message: 'db error' } } });
    const res = await PATCH(makeRequest({ name: 'test', menu_ids: [MENU_A] }), makeProps());
    expect(res.status).toBe(500);
  });

  test('facility_menus 検証が data=null(0件)を返す → 400（?? [] フォールバック・全メニュー不正扱い）', async () => {
    mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
    setupAdmin({ menuValidation: { data: null, error: null } });
    const res = await PATCH(makeRequest({ name: 'test', menu_ids: [MENU_A] }), makeProps());
    expect(res.status).toBe(400);
  });

  test('menu_staff delete 失敗 → 500', async () => {
    mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
    setupAdmin({ deleteResult: { error: { message: 'delete failed' } } });
    const res = await PATCH(makeRequest({ name: 'test', menu_ids: [MENU_A] }), makeProps());
    expect(res.status).toBe(500);
  });

  test('menu_staff insert 失敗 → 500・Sentry＋Slack顕在化・具体的メッセージ（無音失敗禁止）', async () => {
    mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
    const { safeCaptureException } = require('@/lib/safe');
    const { alertCaughtError } = require('@/lib/alert');
    setupAdmin({
      insertSpy: jest.fn(() => Promise.resolve({ error: { message: 'insert failed' } })),
    });
    const res = await PATCH(makeRequest({ name: 'test', menu_ids: [MENU_A] }), makeProps());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('担当メニューの保存に失敗');
    expect(safeCaptureException).toHaveBeenCalledWith(expect.any(Error), 'admin-staff-menu-sync');
    expect(alertCaughtError).toHaveBeenCalledWith('admin-staff-menu-sync', expect.any(Error), '/api/admin/staff/[id]');
  });

  test('menu_ids 未指定 → menu_staff に一切触れない（従来の編集を壊さない）', async () => {
    mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
    const menuStaffSpy = jest.fn();
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'menu_staff') { menuStaffSpy(); return { delete: jest.fn(), insert: jest.fn() }; }
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                maybeSingle: jest.fn(() => Promise.resolve({ data: { id: STAFF_UUID, name: 'test' }, error: null })),
              }),
            }),
          }),
        }),
      };
    });
    const res = await PATCH(makeRequest({ name: 'test' }), makeProps());
    expect(res.status).toBe(200);
    expect(menuStaffSpy).not.toHaveBeenCalled();
  });

  test('menu_ids が UUID でない要素を含む → 400', async () => {
    mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
    const res = await PATCH(makeRequest({ name: 'test', menu_ids: ['not-a-uuid'] }), makeProps());
    expect(res.status).toBe(400);
  });
});
