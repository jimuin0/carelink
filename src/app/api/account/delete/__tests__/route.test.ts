/**
 * @jest-environment node
 *
 * Tests for POST /api/account/delete
 * Key assertions:
 *   - auth.users delete failure must return 500 (user remains; PII not deleted)
 *   - confirmation code required (prevents accidental deletion)
 *   - PII scrub runs before auth delete
 *   - 未完了予約が残る間は退会不可（顧客分・施設分の両ガード）
 */

jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: {},
  checkRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ua: 'test-ua', ip: '127.0.0.1' })),
}));
jest.mock('@/lib/admin-date', () => ({ todayJst: jest.fn(() => '2026-06-23') }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const USER_ID = 'user-delete-test';

const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockDeleteUser = jest.fn();

// SSR client (anon key — reads session)
jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: mockGetUser } }),
}));

// Service role client (supabase-js createClient)
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: mockFrom,
    auth: { admin: { deleteUser: mockDeleteUser } },
  }),
}));

import { POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeRequest(body: object = { confirmation: 'DELETE' }) {
  return new Request('http://localhost/api/account/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * bookings テーブルのモック。退会ガードの 2 クエリ（顧客自身 / 所有施設）と、
 * PII スクラブの update().eq() の両方をサポートする。
 * - 顧客クエリ: select().eq('user_id').in('status').gte('booking_date') → count=own
 * - 施設クエリ: select().in('facility_id').in('status').gte('booking_date') → count=facility
 *   （.eq が呼ばれたら顧客クエリと判定して own を返す）
 */
function bookingsMock({ own = 0, facility = 0 }: { own?: number | null; facility?: number | null } = {}) {
  const writeResolved = Promise.resolve({ error: null });
  return {
    select: jest.fn(() => {
      let isOwn = false;
      const chain: Record<string, unknown> = {
        eq: jest.fn(() => { isOwn = true; return chain; }),
        in: jest.fn(() => chain),
        gte: jest.fn(() => Promise.resolve({ count: isOwn ? own : facility, data: [], error: null })),
      };
      return chain;
    }),
    update: jest.fn(() => ({ eq: jest.fn(() => writeResolved) })),
    delete: jest.fn(() => ({ eq: jest.fn(() => writeResolved) })),
  };
}

// facility_members の所有施設リスト取得（guard と既存ロジック共通の select().eq().eq() 形）
function facilityMembersMock(data: Array<{ facility_id: string; role?: string }> = []) {
  return {
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue(Promise.resolve({ data, error: null })),
      }),
    }),
    delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ error: null })) }),
  };
}

function genericWriteMock() {
  return {
    delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ error: null })) }),
    update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ error: null })) }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mockDeleteUser.mockResolvedValue({ error: null });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

  // Default: no active bookings, no facility ownership, all DB ops succeed
  mockFrom.mockImplementation((table: string) => {
    if (table === 'bookings') return bookingsMock();
    if (table === 'facility_members') return facilityMembersMock([]);
    return genericWriteMock();
  });
});

// ─── Security guards ──────────────────────────────────────────────────────────

test('未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest());
  expect(res.status).toBe(401);
});

test('レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest());
  expect(res.status).toBe(429);
});

test('CSRFエラー → 403', async () => {
  (checkCsrf as jest.Mock).mockReturnValue(new Response(JSON.stringify({ error: 'csrf' }), { status: 403 }));
  const res = await POST(makeRequest());
  expect(res.status).toBe(403);
});

// ─── Input validation ─────────────────────────────────────────────────────────

test('confirmationなし → 400', async () => {
  const res = await POST(makeRequest({}));
  expect(res.status).toBe(400);
});

test('confirmation が "DELETE" 以外 → 400', async () => {
  const res = await POST(makeRequest({ confirmation: 'delete' }));
  expect(res.status).toBe(400);
});

test('不正なJSONボディ → 400', async () => {
  const req = new Request('http://localhost/api/account/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'invalid json',
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

// ─── 退会ガード: 未完了予約が残る間は不可 ──────────────────────────────────────

test('顧客自身に未完了予約が残る → 409（退会不可・削除実行なし）', async () => {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'bookings') return bookingsMock({ own: 2 });
    if (table === 'facility_members') return facilityMembersMock([]);
    return genericWriteMock();
  });
  const res = await POST(makeRequest());
  expect(res.status).toBe(409);
  expect(mockDeleteUser).not.toHaveBeenCalled();
});

test('所有施設に未完了予約が残る → 409（退会不可・削除実行なし）', async () => {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'bookings') return bookingsMock({ own: 0, facility: 3 });
    if (table === 'facility_members') return facilityMembersMock([{ facility_id: 'fac-1', role: 'owner' }]);
    return genericWriteMock();
  });
  const res = await POST(makeRequest());
  expect(res.status).toBe(409);
  expect(mockDeleteUser).not.toHaveBeenCalled();
});

test('オーナーで施設予約 count が null → ?? 0 で 0 扱い → 退会続行（200）', async () => {
  const mockSuspendUpdate = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ error: null })) });
  const mockNeq = jest.fn().mockReturnValue(Promise.resolve({ count: 0, error: null }));
  const mockMemberCheckSelect = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ neq: mockNeq }) }) });
  mockFrom.mockImplementation((table: string) => {
    if (table === 'bookings') return bookingsMock({ own: 0, facility: null });
    if (table === 'facility_members') {
      return {
        select: jest.fn().mockImplementation((fields: string, opts?: object) => {
          if (opts && (opts as any).count === 'exact') return mockMemberCheckSelect(fields, opts);
          return { eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ data: [{ facility_id: 'fac-1', role: 'owner' }], error: null })) }) };
        }),
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ error: null })) }),
      };
    }
    if (table === 'facility_profiles') return { update: mockSuspendUpdate };
    return genericWriteMock();
  });
  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
});

test('未完了予約の count が null → 0 扱いで退会続行（200）', async () => {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'bookings') {
      return {
        select: jest.fn(() => {
          const chain: Record<string, unknown> = {
            eq: jest.fn(() => chain),
            in: jest.fn(() => chain),
            gte: jest.fn(() => Promise.resolve({ count: null, data: [], error: null })),
          };
          return chain;
        }),
        update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })),
        delete: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })),
      };
    }
    if (table === 'facility_members') return facilityMembersMock([]);
    return genericWriteMock();
  });
  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
});

// ─── Critical: auth.users delete failure ─────────────────────────────────────

test('auth.users削除失敗 → 500 (ユーザーデータが残存するため公開しない)', async () => {
  mockDeleteUser.mockResolvedValue({ error: { message: 'auth delete failed' } });
  const res = await POST(makeRequest());
  expect(res.status).toBe(500);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test('正常削除フロー → 200 success:true', async () => {
  const res = await POST(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.success).toBe(true);
  expect(mockDeleteUser).toHaveBeenCalledWith(USER_ID);
});

test('writeAuditLog が呼ばれる', async () => {
  const { writeAuditLog } = require('@/lib/audit-logger');
  await POST(makeRequest());
  await new Promise(r => setTimeout(r, 10));
  expect(writeAuditLog).toHaveBeenCalled();
});

test('PII削除部分失敗 → ログ記録して続行', async () => {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'bookings') return bookingsMock();
    if (table === 'line_user_links') {
      return {
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockRejectedValue(new Error('DB failure')) }),
      };
    }
    if (table === 'facility_members') return facilityMembersMock([]);
    return genericWriteMock();
  });

  const res = await POST(makeRequest());
  // Should still succeed (partial PII failure is logged, not fatal)
  expect(res.status).toBe(200);
});

test('PII削除でerrorあり → ログ記録して続行', async () => {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'bookings') return bookingsMock();
    if (table === 'favorites') {
      return {
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ error: { message: 'constraint' } })) }),
      };
    }
    if (table === 'facility_members') return facilityMembersMock([]);
    return genericWriteMock();
  });

  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
});

test('施設オーナー(他オーナーなし) → 施設を停止', async () => {
  const mockSuspendEq = jest.fn().mockReturnValue(Promise.resolve({ error: null }));
  const mockSuspendUpdate = jest.fn().mockReturnValue({ eq: mockSuspendEq });
  const mockNeq = jest.fn().mockReturnValue(Promise.resolve({ count: 0, error: null }));
  const mockMemberCheckEq2 = jest.fn().mockReturnValue({ neq: mockNeq });
  const mockMemberCheckEq1 = jest.fn().mockReturnValue({ eq: mockMemberCheckEq2 });
  const mockMemberCheckSelect = jest.fn().mockReturnValue({ eq: mockMemberCheckEq1 });

  mockFrom.mockImplementation((table: string) => {
    if (table === 'bookings') return bookingsMock();
    if (table === 'facility_members') {
      return {
        select: jest.fn().mockImplementation((fields: string, opts?: object) => {
          if (opts && (opts as any).count === 'exact') return mockMemberCheckSelect(fields, opts);
          return { eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ data: [{ facility_id: 'fac-1', role: 'owner' }], error: null })) }) };
        }),
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ error: null })) }),
      };
    }
    if (table === 'facility_profiles') {
      return { update: mockSuspendUpdate };
    }
    return genericWriteMock();
  });

  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
  expect(mockSuspendUpdate).toHaveBeenCalledWith({ status: 'suspended' });
});

test('施設オーナー(他オーナーあり) → 施設停止しない', async () => {
  const mockSuspendUpdate = jest.fn();
  const mockNeq = jest.fn().mockReturnValue(Promise.resolve({ count: 1, error: null }));
  const mockMemberCheckEq2 = jest.fn().mockReturnValue({ neq: mockNeq });
  const mockMemberCheckEq1 = jest.fn().mockReturnValue({ eq: mockMemberCheckEq2 });
  const mockMemberCheckSelect = jest.fn().mockReturnValue({ eq: mockMemberCheckEq1 });

  mockFrom.mockImplementation((table: string) => {
    if (table === 'bookings') return bookingsMock();
    if (table === 'facility_members') {
      return {
        select: jest.fn().mockImplementation((fields: string, opts?: object) => {
          if (opts && (opts as any).count === 'exact') return mockMemberCheckSelect(fields, opts);
          return { eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ data: [{ facility_id: 'fac-1', role: 'owner' }], error: null })) }) };
        }),
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ error: null })) }),
      };
    }
    if (table === 'facility_profiles') {
      return { update: mockSuspendUpdate };
    }
    return genericWriteMock();
  });

  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
  expect(mockSuspendUpdate).not.toHaveBeenCalled();
});

test('施設停止失敗 → ログ記録して続行', async () => {
  const mockNeq = jest.fn().mockReturnValue(Promise.resolve({ count: 0, error: null }));
  const mockMemberCheckEq2 = jest.fn().mockReturnValue({ neq: mockNeq });
  const mockMemberCheckEq1 = jest.fn().mockReturnValue({ eq: mockMemberCheckEq2 });
  const mockMemberCheckSelect = jest.fn().mockReturnValue({ eq: mockMemberCheckEq1 });

  mockFrom.mockImplementation((table: string) => {
    if (table === 'bookings') return bookingsMock();
    if (table === 'facility_members') {
      return {
        select: jest.fn().mockImplementation((fields: string, opts?: object) => {
          if (opts && (opts as any).count === 'exact') return mockMemberCheckSelect(fields, opts);
          return { eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ data: [{ facility_id: 'fac-2', role: 'owner' }], error: null })) }) };
        }),
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ error: null })) }),
      };
    }
    if (table === 'facility_profiles') {
      return { update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ error: { message: 'suspend failed' } })) }) };
    }
    return genericWriteMock();
  });

  const res = await POST(makeRequest());
  // suspend failure is logged but not fatal
  expect(res.status).toBe(200);
});

test('facility_members削除失敗 → ログ記録して続行', async () => {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'bookings') return bookingsMock();
    if (table === 'facility_members') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue(Promise.resolve({ data: [], error: null })),
          }),
        }),
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ error: { message: 'member delete failed' } })) }),
      };
    }
    return genericWriteMock();
  });

  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
});

test('未処理例外 → 500', async () => {
  mockGetUser.mockRejectedValue(new Error('Unexpected error'));
  const res = await POST(makeRequest());
  expect(res.status).toBe(500);
});

// Branch coverage: if (memberships) の true ブランチ（memberships が空配列）
test('施設メンバーシップが空配列 → ループをスキップして正常削除', async () => {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'bookings') return bookingsMock();
    if (table === 'facility_members') return facilityMembersMock([]);
    return genericWriteMock();
  });

  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
});

// Branch coverage: (count ?? 0) === 0 の null coalescing ブランチ（count = null → 0 として評価）
test('オーナーカウントが null → ?? 0 で 0 として評価 → 施設停止', async () => {
  const mockSuspendEq = jest.fn().mockReturnValue(Promise.resolve({ error: null }));
  const mockSuspendUpdate = jest.fn().mockReturnValue({ eq: mockSuspendEq });
  // count = null triggers the ?? 0 branch → (null ?? 0) === 0 → true → suspend
  const mockNeq = jest.fn().mockReturnValue(Promise.resolve({ count: null, error: null }));
  const mockMemberCheckEq2 = jest.fn().mockReturnValue({ neq: mockNeq });
  const mockMemberCheckEq1 = jest.fn().mockReturnValue({ eq: mockMemberCheckEq2 });
  const mockMemberCheckSelect = jest.fn().mockReturnValue({ eq: mockMemberCheckEq1 });

  mockFrom.mockImplementation((table: string) => {
    if (table === 'bookings') return bookingsMock();
    if (table === 'facility_members') {
      return {
        select: jest.fn().mockImplementation((fields: string, opts?: object) => {
          if (opts && (opts as any).count === 'exact') return mockMemberCheckSelect(fields, opts);
          return { eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ data: [{ facility_id: 'fac-null', role: 'owner' }], error: null })) }) };
        }),
        delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ error: null })) }),
      };
    }
    if (table === 'facility_profiles') {
      return { update: mockSuspendUpdate };
    }
    return genericWriteMock();
  });

  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
  // count=null treated as 0 → facility should be suspended
  expect(mockSuspendUpdate).toHaveBeenCalledWith({ status: 'suspended' });
});

// Branch coverage: if (memberships) false branch: DB returns null for memberships
test('facility_members が null → ループをスキップして正常削除', async () => {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'bookings') return bookingsMock();
    if (table === 'facility_members') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            // data: null → memberships is null → if (memberships) is false → loop skipped
            eq: jest.fn().mockReturnValue(Promise.resolve({ data: null, error: null })),
          }),
        }),
        delete: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue(Promise.resolve({ error: null })),
        }),
      };
    }
    return genericWriteMock();
  });

  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
});

// Branch coverage: filter: r.status === 'fulfilled' but .error is falsy (no failure logged)
test('PII削除が全て成功 → failedOps は空 → ログなし', async () => {
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  // Default mock: all ops succeed with error: null
  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
  // PII partial-failure log should NOT have been called
  expect(consoleSpy).not.toHaveBeenCalledWith(
    expect.stringContaining('PII deletion partial failure'),
    expect.anything(),
  );
  consoleSpy.mockRestore();
});

test('auth削除は必ずPIIスクラブの後に実行される', async () => {
  const callOrder: string[] = [];
  mockFrom.mockImplementation((table: string) => {
    if (table === 'bookings') return bookingsMock();
    if (table === 'facility_members') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue(Promise.resolve({ data: [], error: null })),
          }),
        }),
        delete: jest.fn().mockReturnValue({
          eq: jest.fn().mockImplementation(() => { callOrder.push('facility_members_delete'); return Promise.resolve({ error: null }); }),
        }),
      };
    }
    return {
      delete: jest.fn().mockReturnValue({ eq: jest.fn().mockImplementation(() => { callOrder.push(`${table}_delete`); return Promise.resolve({ error: null }); }) }),
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockImplementation(() => { callOrder.push(`${table}_update`); return Promise.resolve({ error: null }); }) }),
    };
  });
  mockDeleteUser.mockImplementation(() => { callOrder.push('auth_delete'); return Promise.resolve({ error: null }); });

  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
  // auth_delete must come after PII scrub operations
  const authIdx = callOrder.indexOf('auth_delete');
  expect(authIdx).toBeGreaterThan(0);
  expect(callOrder.slice(0, authIdx).length).toBeGreaterThan(0);
});
