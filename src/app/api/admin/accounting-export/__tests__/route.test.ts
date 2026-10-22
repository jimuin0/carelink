/**
 * @jest-environment node
 *
 * Tests for GET /api/admin/accounting-export
 * Key assertions:
 *   - Non-member → 401 (IDOR prevention)
 *   - Invalid format → 400
 *   - Date range > 366 days → 400 (DoS prevention)
 *   - to < from → 400
 *   - CSV injection prevention (= prefix with ')
 *   - Success → 200 text/csv with BOM
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

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
import { GET } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

function makeGetRequest(params: Record<string, string> = { facility_id: FACILITY_UUID }) {
  const url = new URL('http://localhost/api/admin/accounting-export');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), { method: 'GET' });
}

function memberChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function bookingQueryChain(data: unknown[], error: unknown = null) {
  const chain: Record<string, jest.Mock> = {};
  const self = () => chain;
  chain.select = jest.fn(self);
  chain.eq = jest.fn(self);
  chain.in = jest.fn(self);
  chain.order = jest.fn(self);
  chain.gte = jest.fn(self);
  chain.lte = jest.fn(self);
  chain.range = jest.fn(() => Promise.resolve({ data, error }));
  return chain;
}

// 複数メニューの名前解決クエリ（admin.from('facility_menus').select().eq().in() を await）用のモック。
function menuLookupChain(data: unknown, error: unknown = null) {
  const chain: Record<string, jest.Mock> = {};
  const self = () => chain;
  chain.select = jest.fn(self);
  chain.eq = jest.fn(self);
  chain.in = jest.fn(() => Promise.resolve({ data, error }));
  return chain;
}

// profiles 別取得クエリ（admin.from('profiles').select().in() を await）用のモック。
function profilesLookupChain(data: unknown, error: unknown = null) {
  const chain: Record<string, jest.Mock> = {};
  const self = () => chain;
  chain.select = jest.fn(self);
  chain.in = jest.fn(() => Promise.resolve({ data, error }));
  return chain;
}

// admin.from をテーブル名でディスパッチ（bookings=ページング, facility_menus=名前解決）。
function dispatchAdminFrom(bookingData: unknown[], menuData: unknown, menuError: unknown = null) {
  return (table: string) =>
    table === 'facility_menus'
      ? menuLookupChain(menuData, menuError)
      : bookingQueryChain(bookingData);
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── Guards ───────────────────────────────────────────────────────────────────

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

test('GET: facility_id なし → 400', async () => {
  const res = await GET(makeGetRequest({}));
  expect(res.status).toBe(400);
});

test('GET: 不正なfacility_id → 400', async () => {
  const res = await GET(makeGetRequest({ facility_id: 'bad-id' }));
  expect(res.status).toBe(400);
});

test('GET: 非管理者 → 401 (IDOR防止)', async () => {
  mockAnonFrom.mockReturnValue(memberChain(null));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(401);
});

// ─── Parameter validation ──────────────────────────────────────────────────────

test('GET: 不正なformat → 400', async () => {
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'quickbooks' }));
  expect(res.status).toBe(400);
});

test('GET: 日付範囲 > 366日 → 400 (DoS防止)', async () => {
  const res = await GET(makeGetRequest({
    facility_id: FACILITY_UUID,
    from: '2024-01-01',
    to: '2025-12-31', // 731 days
  }));
  expect(res.status).toBe(400);
});

test('GET: to < from → 400', async () => {
  const res = await GET(makeGetRequest({
    facility_id: FACILITY_UUID,
    from: '2026-06-01',
    to: '2026-01-01',
  }));
  expect(res.status).toBe(400);
});

test('GET: DB失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([], { message: 'DB error' }));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'freee' }));
  expect(res.status).toBe(500);
});

// ─── CSV injection prevention ─────────────────────────────────────────────────

test('GET: CSVインジェクション防止 (= で始まる値は引用符付き)', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([{
    id: '=SUM(A1)',
    booking_date: '2026-01-01',
    menu: { name: '=CMD|"calc"!A0' },    total_amount: 5000,
    status: 'completed',
    profiles: { display_name: '=EVIL', email: 'test@example.com' },
  }]));

  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  expect(csv).toContain("'=SUM");
  expect(csv).toContain("'=CMD");
  expect(csv).toContain("'=EVIL");
});

test('GET: user_id ありの行は profiles を別取得してマージ（embed不使用の回帰）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'profiles') return profilesLookupChain([
      { id: 'u1', display_name: '山田太郎', email: 'y@example.com' }, // present（?? undefined 左）
      { id: 'u2', display_name: null, email: null },                  // null（?? undefined 右）
    ]);
    if (table === 'facility_menus') return menuLookupChain([]);
    return bookingQueryChain([
      { id: 'b1', booking_date: '2026-01-01', menu: null, total_amount: 5000, status: 'completed', user_id: 'u1' },
      { id: 'b2', booking_date: '2026-01-02', menu: null, total_amount: 3000, status: 'completed', user_id: 'u2' },
      { id: 'b3', booking_date: '2026-01-03', menu: null, total_amount: 2000, status: 'completed', user_id: 'umiss' }, // profMap.get → null
      { id: 'b4', booking_date: '2026-01-04', menu: null, total_amount: 1000, status: 'completed', user_id: null },    // ternary → null
    ]);
  });
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  expect(csv).toContain('山田太郎');
});

test('GET: profiles 取得失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation((table: string) =>
    table === 'profiles'
      ? profilesLookupChain(null, { message: 'db' })
      : bookingQueryChain([{ id: 'b1', booking_date: '2026-01-01', menu: null, total_amount: 5000, status: 'completed', user_id: 'u1' }]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  expect(res.status).toBe(500);
});

test('GET: profiles が null(エラー無し) でも 200（プロフィール無し扱い）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation((table: string) =>
    table === 'profiles'
      ? profilesLookupChain(null)
      : bookingQueryChain([{ id: 'b1', booking_date: '2026-01-01', menu: null, total_amount: 5000, status: 'completed', user_id: 'u1' }]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  expect(res.status).toBe(200);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test('GET: freee形式 → 200 text/csv + BOM', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([{
    id: 'booking-1',
    booking_date: '2026-01-15',
    menu: [{ name: 'カット' }],    total_amount: 3300, // 配列形 embed（to-one が配列で返るケース）も検証
    status: 'completed',
    profiles: { display_name: '田中花子', email: null },
  }]));

  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'freee', from: '2026-01-01', to: '2026-01-31' }));
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toContain('text/csv');
  expect(res.headers.get('Content-Disposition')).toContain('freee');
  const csv = await res.text();
  expect(csv).toContain('取引日'); // freee header
  expect(csv).toContain('収支区分'); // freee-specific column
});

test('GET: mf形式 → 200 text/csv', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([{
    id: 'booking-1',
    booking_date: '2026-01-15',
    menu: { name: 'カラー' },    total_amount: 8800,
    status: 'confirmed',
    profiles: null,
  }]));

  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'mf' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  expect(csv).toContain('借方勘定科目'); // MF header
});

test('GET: レートリミット params', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([]));
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBeGreaterThan(0);
  expect(call[3]).toBe(60_000);
});

test('GET: generic形式 → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([{
    id: 'b1',
    booking_date: '2026-01-01',
    menu: { name: 'カット' },    total_amount: 3300,
    status: 'completed',
    profiles: { display_name: '山田太郎', email: 'yamada@example.com' },
  }]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  expect(res.status).toBe(200);
});

test('GET: 366日範囲 → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([]));
  const res = await GET(makeGetRequest({
    facility_id: FACILITY_UUID,
    format: 'generic',
    from: '2025-01-01',
    to: '2026-01-01',
  }));
  expect(res.status).toBe(200);
});

test('GET: writeAuditLog が呼ばれる', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([]));
  const { writeAuditLog } = require('@/lib/audit-logger');
  await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  await new Promise(r => setTimeout(r, 10));
  expect(writeAuditLog).toHaveBeenCalled();
});

// ─── Parameter validation (additional) ────────────────────────────────────────

test('GET: from が不正な日付形式 → 400', async () => {
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, from: 'not-a-date' }));
  expect(res.status).toBe(400);
});

test('GET: to が不正な日付形式 → 400', async () => {
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, to: 'not-a-date' }));
  expect(res.status).toBe(400);
});

// Branch coverage: line 19 — csvEscape で val が null/undefined の場合に空文字列フォールバック（false分岐）
test('GET: メニュー名にカンマを含む値は引用符で囲まれる（csv escape ブランチ）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([{
    id: 'b-comma',
    booking_date: '2026-03-01',
    menu: { name: 'カット,カラー' },    total_amount: 5500,
    status: 'completed',
    profiles: { display_name: '佐藤,次郎', email: 'sato@example.com' },
  }]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  // カンマを含む値は "..." で囲まれる
  expect(csv).toContain('"カット,カラー"');
});

// ─── Null fallback branches in CSV generation ──────────────────────────────────

test('GET: bookingsがnullのとき空CSVを返す', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain(null as unknown as unknown[]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'freee' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  expect(csv).toContain('取引日');
});

test('GET: freee形式 fromなし → filenameにallを使う', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'freee' }));
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Disposition')).toContain('all');
});

test('GET: freee形式 profiles配列・null値フィールド', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([{
    id: 'b1',
    booking_date: '2026-01-01',
    menu: null,    total_amount: null,
    status: 'completed',
    profiles: [{ display_name: null, email: null }],
  }]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'freee' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  expect(csv).toContain('2026');
});

test('GET: mf形式 fromなし・null値フィールド', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([{
    id: 'b1',
    booking_date: '2026-01-01',
    menu: null,    total_amount: null,
    status: 'confirmed',
    profiles: [{ display_name: null }],
  }]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'mf' }));
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Disposition')).toContain('all');
});

test('GET: generic形式 fromなし・null値フィールド', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([{
    id: 'b1',
    booking_date: '2026-01-01',
    menu: null,    total_amount: null,
    status: 'completed',
    profiles: [{ display_name: null, email: null }],
  }]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Disposition')).toContain('all');
});

test('GET: mf形式 bookingsがnull → 空CSV', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain(null as unknown as unknown[]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'mf' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  expect(csv).toContain('借方勘定科目');
});

test('GET: generic形式 bookingsがnull → 空CSV', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain(null as unknown as unknown[]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  expect(csv).toContain('予約ID');
});

test('GET: CSV値にカンマ/引用符/改行 → 引用符で囲まれエスケープ', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([{
    id: 'b-quote',
    booking_date: '2026-01-01',
    menu: { name: 'メ"ニュ,ー\n改行' },    total_amount: 1000,
    status: 'completed',
    profiles: { display_name: 'カンマ,テスト', email: 'a@b.c' },
  }]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  // Embedded comma forces quoting
  expect(csv).toContain('"カンマ,テスト"');
  // Embedded quote escaped as ""
  expect(csv).toContain('""');
});

test('GET: from のみ指定 (to なし) → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic', from: '2026-01-01' }));
  expect(res.status).toBe(200);
});

test('GET: to のみ指定 (from なし) → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(bookingQueryChain([]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic', to: '2026-01-31' }));
  expect(res.status).toBe(200);
});

test('GET: 正規表現は通過するがNaNの日付 → 400', async () => {
  // '2026-99-99' passes /^\d{4}-\d{2}-\d{2}$/ but new Date() returns Invalid Date
  const res = await GET(makeGetRequest({
    facility_id: FACILITY_UUID,
    from: '2026-99-99',
    to: '2026-99-99',
  }));
  expect(res.status).toBe(400);
});

// Branch coverage: line 19 branch 1 (FALSE) — csvEscape の `val ?? ''` で val が undefined のとき '' にフォールバック
// profiles フィールドが undefined の予約レコードで generic 形式を出力する
test('GET: generic形式 profiles未定義 → csvEscape の ?? \'\' false分岐が動く', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  // profiles field is undefined (not in the object) → csvEscape(undefined) → String(undefined ?? '') = ''
  mockAdminFrom.mockReturnValue(bookingQueryChain([{
    id: 'b-undef',
    booking_date: '2026-04-01',
    menu: null,    total_amount: undefined,
    status: 'completed',
    profiles: undefined,
  }]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  // Should contain the header row and a data row (even if fields are empty)
  expect(csv).toContain('予約ID');
});

// ─── 複数メニュー（menu_ids）の会計CSV 名前解決（8体監査 A6 追検証）────────────────
const MENU1 = '44444444-4444-4444-4444-444444444444';
const MENU2 = '55555555-5555-5555-5555-555555555555';

test('GET: 複数メニュー予約 → menu_ids 全名を「、」連結で出力', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(dispatchAdminFrom(
    [{
      id: 'b-multi',
      booking_date: '2026-05-01',
      menu: { name: 'カット' }, // embed は先頭1件のみ
      menu_ids: [MENU1, MENU2],
      total_amount: 8800,
      status: 'completed',
      profiles: { display_name: '複数太郎', email: 'multi@example.com' },
    }],
    [{ id: MENU1, name: 'カット' }, { id: MENU2, name: 'カラー' }],
  ));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  // 先頭1件('カット')ではなく全件連結が出力される
  expect(csv).toContain('カット、カラー');
});

test('GET: 複数メニューだが名前解決クエリが空 → embed フォールバック', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  // menu_ids は複数だが facility_menus が削除済み等で名前が1件も解決できない（names.length===0）
  mockAdminFrom.mockImplementation(dispatchAdminFrom(
    [{
      id: 'b-multi-gone',
      booking_date: '2026-05-02',
      menu: { name: 'カット' },
      menu_ids: [MENU1, MENU2],
      total_amount: 5000,
      status: 'completed',
      profiles: { display_name: '解決不能', email: 'x@example.com' },
    }],
    [], // 解決結果ゼロ
  ));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  expect(csv).toContain('カット'); // embed フォールバック
  expect(csv).not.toContain('カット、'); // 連結はしていない
});

test('GET: 複数メニューだが名前解決クエリが null データ → embed フォールバック', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  // menuRows が null（?? [] の右辺分岐）
  mockAdminFrom.mockImplementation(dispatchAdminFrom(
    [{
      id: 'b-multi-null',
      booking_date: '2026-05-03',
      menu: { name: 'パーマ' },
      menu_ids: [MENU1, MENU2],
      total_amount: 6000,
      status: 'completed',
      profiles: { display_name: 'ヌル', email: 'n@example.com' },
    }],
    null,
  ));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  expect(csv).toContain('パーマ'); // embed フォールバック
});

test('GET: menu_ids が1件のみ → 名前解決クエリは走らず embed を使う', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  // menu_ids.length<=1 のため multiMenuIds は空＝facility_menus クエリ自体が走らない
  mockAdminFrom.mockReturnValue(bookingQueryChain([{
    id: 'b-single',
    booking_date: '2026-05-04',
    menu: { name: 'カット' },
    menu_ids: [MENU1],
    total_amount: 3300,
    status: 'completed',
    profiles: { display_name: '単一', email: 's@example.com' },
  }]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format: 'generic' }));
  expect(res.status).toBe(200);
  const csv = await res.text();
  expect(csv).toContain('カット');
});

// ─── 顧客名・メールは予約そのものの値を使う（2026年10月22日）─────────────────────
// 電話・店頭で店舗が手入力した予約と、未ログインのゲスト予約は user_id が NULL。以前は profiles
// だけを見ていたため、会計CSVの顧客名・メール（freee の取引先・MF の摘要の氏名）が空欄になっていた。
describe('顧客名・メールは予約に保存された値を使う', () => {
  function walkInRows() {
    return [{
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      booking_date: '2026-10-05',
      user_id: null,
      customer_name: '山田花子',
      email: 'hanako@example.com',
      menu: { name: 'カット' },
      menu_ids: null,
      total_amount: 5500,
      status: 'completed',
    }];
  }

  async function exportCsv(format: string, rows: unknown[], profiles: unknown[] = []) {
    const bookingChain = bookingQueryChain(rows);
    mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'profiles') return profilesLookupChain(profiles);
      if (table === 'facility_menus') return menuLookupChain([]);
      return bookingChain;
    });
    const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, format }));
    expect(res.status).toBe(200);
    // 行末の空白も検査したいので trim しない（最終行の改行だけ除く）
    return { lines: (await res.text()).replace(/^﻿/, '').split('\n').filter((line) => line !== ''), bookingChain };
  }

  test('予約から顧客名・メールの列を読み、完了（来店済み）だけを出力する', async () => {
    const { bookingChain } = await exportCsv('generic', walkInRows());
    const columns = String(bookingChain.select.mock.calls[0][0]).split(',').map((c) => c.trim());
    expect(columns).toEqual(expect.arrayContaining(['customer_name', 'email']));
    expect(bookingChain.eq).toHaveBeenCalledWith('status', 'completed');
    expect(bookingChain.eq).not.toHaveBeenCalledWith('status', 'confirmed');
  });

  test('電話・店頭予約（user_id なし）: 汎用CSVに顧客名とメールが入る', async () => {
    const { lines } = await exportCsv('generic', walkInRows());
    expect(lines[1]).toBe('aaaaaaaa-0000-4000-8000-000000000001,2026-10-05,山田花子,hanako@example.com,カット,5500,completed');
  });

  test('電話・店頭予約（user_id なし）: freee の取引先に顧客名が入る', async () => {
    const { lines } = await exportCsv('freee', walkInRows());
    expect(lines[1]).toBe('2026-10-05,収入,aaaaaaaa,山田花子,売上高,課税売上10%,5000,内税,500,カット');
  });

  test('電話・店頭予約（user_id なし）: MF の摘要に「メニュー 顧客名」が入る', async () => {
    const { lines } = await exportCsv('mf', walkInRows());
    expect(lines[1]).toBe('2026-10-05,現金,,対象外,5500,売上高,,課税売上10%,5500,カット 山田花子');
  });

  test('会員の予約: 予約時の名前・メールを優先し、空のときだけプロフィールで補う', async () => {
    const rows = [
      { id: 'b-own', booking_date: '2026-10-06', user_id: 'u1', customer_name: '予約時の名前', email: 'booking@example.com', menu: null, menu_ids: null, total_amount: 1000, status: 'completed' },
      { id: 'b-blank', booking_date: '2026-10-07', user_id: 'u1', customer_name: '  ', email: null, menu: null, menu_ids: null, total_amount: 1000, status: 'completed' },
      { id: 'b-none', booking_date: '2026-10-08', user_id: 'u2', customer_name: '', email: '', menu: null, menu_ids: null, total_amount: 1000, status: 'completed' },
    ];
    const { lines } = await exportCsv('generic', rows, [
      { id: 'u1', display_name: 'プロフィール名', email: 'profile@example.com' },
      { id: 'u2', display_name: null, email: null },
    ]);
    expect(lines[1]).toBe('b-own,2026-10-06,予約時の名前,booking@example.com,,1000,completed');
    expect(lines[2]).toBe('b-blank,2026-10-07,プロフィール名,profile@example.com,,1000,completed');
    expect(lines[3]).toBe('b-none,2026-10-08,,,,1000,completed');
  });

  test('顧客名が空でも MF の摘要の末尾に空白を残さない', async () => {
    const { lines } = await exportCsv('mf', [{ ...walkInRows()[0], customer_name: '', email: null }]);
    expect(lines[1].endsWith(',カット')).toBe(true);
  });

  test('予約の顧客名も数式インジェクション対策を通る', async () => {
    const { lines } = await exportCsv('generic', [{ ...walkInRows()[0], customer_name: '=HYPERLINK("x")', email: '+cmd@example.com' }]);
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")",'+cmd@example.com`);
  });
});
