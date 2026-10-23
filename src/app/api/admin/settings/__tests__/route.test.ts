/**
 * @jest-environment node
 *
 * Tests for PATCH /api/admin/settings
 * Key assertions:
 *   - Non-admin → 401 (IDOR prevention)
 *   - Business hours: close <= open → 400
 *   - ?action=status: published/suspended/draft transitions
 *   - DB update failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const mockAdminFrom = jest.fn();
const mockAdminRpc = jest.fn();
const mockAnonFrom = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom, rpc:mockAdminRpc }),
}));

import { NextRequest } from 'next/server';
import { PATCH } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-logger';
import { FACILITY_INPUT_LIMITS } from '@/lib/facility-input-limits';

const VALID_BODY = { name: 'テスト施設' };

test.each(['ok', 'missing-photo', 'db-error', 'wrong-facility', 'malformed'])('main photo commits existence and authorization in one RPC: %s', async mode => {
  const photoId = '44444444-4444-4444-8444-444444444444';
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminRpc.mockResolvedValue({ data: mode === 'missing-photo' ? [] : [{ id: mode === 'wrong-facility' ? USER_ID : FACILITY_UUID }], error: mode === 'db-error' ? { message: '08006' } : null });
  const response = await PATCH(makePatchRequest({ photoId: mode === 'malformed' ? 'invalid' : photoId }, { facility_id: FACILITY_UUID, action: 'main-photo' }));
  expect(response.status).toBe({ ok: 200, 'missing-photo': 409, 'db-error': 500, 'wrong-facility': 409, malformed: 400 }[mode]);
  expect(mockAdminFrom).not.toHaveBeenCalled();
  if (mode !== 'malformed') expect(mockAdminRpc).toHaveBeenCalledWith('set_facility_main_photo_atomic', { p_actor_id: USER_ID, p_facility_id: FACILITY_UUID, p_photo_id: photoId });
  else expect(mockAdminRpc).not.toHaveBeenCalled();
  if (mode !== 'ok') expect(writeAuditLog).not.toHaveBeenCalled();
});

test.each([
  ['name', FACILITY_INPUT_LIMITS.name], ['city', FACILITY_INPUT_LIMITS.city],
  ['address', FACILITY_INPUT_LIMITS.address], ['building', FACILITY_INPUT_LIMITS.building],
  ['nearest_station', FACILITY_INPUT_LIMITS.nearestStation], ['regular_holiday', FACILITY_INPUT_LIMITS.regularHoliday],
  ['website_url', FACILITY_INPUT_LIMITS.website],
])('PATCH preserves intake upper bound for %s and rejects overflow', async (field, maxLength) => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const prefix = field === 'website_url' ? 'https://example.invalid/' : '';
  const value = prefix + 'a'.repeat(Number(maxLength) - prefix.length);
  expect((await PATCH(makePatchRequest({ ...VALID_BODY, [field]: value }))).status).toBe(200);
  expect((await PATCH(makePatchRequest({ ...VALID_BODY, [field]: value + 'a' }))).status).toBe(400);
});
const locationConflict = { code: '23514', message: 'new row violates check constraint "published_facility_location_present"' };

test('PATCH: published住所削除のDB拒否を成功にしない', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain(locationConflict));
  const res = await PATCH(makePatchRequest({ ...VALID_BODY, address: '' }));
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: expect.stringContaining('先に非公開') });
});

test('PATCH: gate通過後の競合によるDB拒否も409', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  publishMocks({ menu: 1, photo: 1, staff: 1, updateError: locationConflict });
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  expect(res.status).toBe(409);
});

// 2026年10月23日 神原さん決定：曜日別の営業時間は無料掲載の公開条件。
// DB の公開 RPC（migration 20261023170000）も同じ規則で断る。
const hoursConflict = { code: '23514', message: '"published_facility_hours_confirmed"' };

test.each([
  ['未保存', null],
  ['曜日が欠けている', { mon: { open: '10:00', close: '19:00' } }],
])('PATCH: 営業時間が%sの施設は公開されない（RPC を呼ばない）', async (_label, businessHours) => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  publishMocks({ menu: 1, photo: 1, staff: 1, businessHours });
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: '公開するには次の項目が必要です', missing: ['全曜日の営業時間・定休日を確認して保存してください'] });
  expect(mockAdminRpc).not.toHaveBeenCalled();
  expect(writeAuditLog).not.toHaveBeenCalled();
});

test('PATCH: gate通過後に営業時間が変わり DB が公開を断ったら409（公開を記録しない）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  publishMocks({ menu: 1, photo: 1, staff: 1, updateError: hoursConflict });
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: expect.stringContaining('営業時間'), missing: ['全曜日の営業時間・定休日を確認して保存してください'] });
  expect(writeAuditLog).not.toHaveBeenCalled();
});

test('PATCH: 公開中の施設が営業時間を欠けた形で保存しようとして DB が断ったら409（営業時間欄に理由）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain(hoursConflict));
  const res = await PATCH(makePatchRequest({ ...VALID_BODY, business_hours: { mon: { open: '10:00', close: '19:00' } } }));
  expect(res.status).toBe(409);
  const json = await res.json();
  expect(json.error).toContain('先に非公開');
  expect(json.fields).toEqual({ business_hours: json.error });
  expect(writeAuditLog).not.toHaveBeenCalled();
});

function makePatchRequest(body: object = VALID_BODY, params: Record<string, string> = { facility_id: FACILITY_UUID }) {
  const url = new URL('http://localhost/api/admin/settings');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function memberChain(data: unknown, error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error })),
  };
}

function updateChain(error: unknown = null, data: unknown = { id: FACILITY_UUID }) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ error, data }) }),
      }),
    }),
  };
}

// 公開ガードの count クエリ（.select('id',{count,head}).eq(...) / staff は .eq().eq()）を
// thenable で表現。await すると { count, error } に解決する。select/eq は自身を返す。
function countChain(count: number | null, error: unknown = null) {
  const obj: Record<string, unknown> = {};
  obj.select = jest.fn(() => obj);
  obj.eq = jest.fn(() => obj);
  // メニュー可視条件（is_published null/true）の .or も自身を返し thenable のまま解決する。
  obj.or = jest.fn(() => obj);
  obj.then = (resolve: (v: { count: number | null; error: unknown }) => unknown) => resolve({ count, error });
  return obj;
}

const CONFIRMED_HOURS = {
  mon: { open: '10:00', close: '19:00' }, tue: null, wed: { open: '10:00', close: '19:00' }, thu: { open: '10:00', close: '19:00' },
  fri: { open: '10:00', close: '19:00' }, sat: { open: '10:00', close: '17:00' }, sun: null,
};

// facility_profiles は【2つの用途で読まれる】ので、update と select の両方を持つ。
// 公開ガードが地域（prefecture / city）も必須条件に加えたため（facility-publish-gate.ts）、
// ガードは .select('prefecture, city').eq('id',…).single() を呼び、route 本体はその後
// .update().eq() で status を書く。update だけのスタブに倒すと
// 「admin.from(...).select is not a function」でガード側が落ちる。
function facilityProfileChain(opts: {
  updateError?: unknown;
  prefecture?: string | null;
  city?: string | null;
  address?: string | null;
  businessHours?: unknown;
  profileError?: unknown;
} = {}) {
  // 既定は「地域と営業時間が入っている」＝ガードの掲載条件は充足。個々のテストが検証したいのは
  // メニュー/写真/スタッフの条件なので、地域で落ちない既定にしておく。
  const prefecture = opts.prefecture === undefined ? '大阪府' : opts.prefecture;
  const city = opts.city === undefined ? '堺市' : opts.city;
  const address = opts.address === undefined ? '検証町1-1' : opts.address;
  const business_hours = opts.businessHours === undefined ? CONFIRMED_HOURS : opts.businessHours;
  return {
    update: updateChain(opts.updateError ?? null).update,
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        single: jest.fn(() =>
          Promise.resolve({
            data: opts.profileError ? null : { name: '合成店舗', prefecture, city, address, business_hours },
            error: opts.profileError ?? null,
          }),
        ),
      })),
    })),
  };
}

// 公開ガードは facility_menus / facility_photos / staff_profiles を count し、
// facility_profiles から地域を読む。その後 route 本体が facility_profiles を update する。
// テーブル名でディスパッチ（順序・消費数に非依存＝mockReturnValueOnce のキュー残留による
// 次テストへの漏れを防ぐ）。
function publishMocks(opts: {
  menu?: number | null;
  photo?: number | null;
  staff?: number | null;
  countError?: unknown;
  profileError?: unknown;
  updateError?: unknown;
  prefecture?: string | null;
  city?: string | null;
  address?: string | null;
  businessHours?: unknown;
} = {}) {
  // undefined は既定1(充足)、null は明示的にそのまま渡す（route の `?? 0` 分岐検証用）。
  const m = opts.menu === undefined ? 1 : opts.menu;
  const p = opts.photo === undefined ? 1 : opts.photo;
  const s = opts.staff === undefined ? 1 : opts.staff;
  const e = opts.countError ?? null;
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'facility_menus') return countChain(m, e);
    if (table === 'facility_photos') return countChain(p, e);
    if (table === 'staff_profiles') return countChain(s, e);
    return facilityProfileChain({
      updateError: opts.updateError ?? null,
      prefecture: opts.prefecture,
      city: opts.city,
      address: opts.address,
      businessHours: opts.businessHours,
      profileError: opts.profileError,
    });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAdminRpc.mockImplementation(async (_name,args) => {
    const observed = await mockAdminFrom('facility_profiles').update(args.p_patch).eq(args.p_facility_id).select('id').maybeSingle();
    return { ...observed,data:observed.data ? [observed.data] : [] };
  });
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── Guards ───────────────────────────────────────────────────────────────────

test('PATCH: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makePatchRequest());
  expect(res.status).toBe(401);
});
test.each(['patch','status','photo'])('write-time permission loss rejects %s without successful audit', async kind => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id:FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(memberChain({ photo_url:'https://example.invalid/photo.png' }));
  mockAdminRpc.mockResolvedValue({ data:null,error:{ message:'FACILITY_PERMISSION_REVOKED' } });
  const request = kind === 'status' ? makePatchRequest({ status:'draft' },{ facility_id:FACILITY_UUID,action:'status' })
    : kind === 'photo' ? makePatchRequest({ photoId:'44444444-4444-4444-8444-444444444444' },{ facility_id:FACILITY_UUID,action:'main-photo' })
    : makePatchRequest();
  expect((await PATCH(request)).status).toBe(403); expect(writeAuditLog).not.toHaveBeenCalled();
});
test('settings cannot publish an ownerless facility', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id:FACILITY_UUID }));
  publishMocks(); mockAdminRpc.mockResolvedValue({ data:null,error:{ message:'FACILITY_OWNER_REQUIRED' } });
  expect((await PATCH(makePatchRequest({ status:'published' },{ facility_id:FACILITY_UUID,action:'status' }))).status).toBe(409);
  expect(writeAuditLog).not.toHaveBeenCalled();
});
test('auth error alongside a user is not usable authorization', async () => {
  mockGetUser.mockResolvedValue({ data:{ user:{ id:USER_ID } },error:{ message:'08006' } });
  expect((await PATCH(makePatchRequest())).status).toBe(503); expect(mockAdminRpc).not.toHaveBeenCalled();
});
test.each(['error', 'throw', 'malformed'])('Auth unavailable %s preserves session semantics and refuses all business calls', async mode => {
  if (mode === 'throw') mockGetUser.mockRejectedValue(new Error('synthetic dependency failure'));
  else mockGetUser.mockResolvedValue(mode === 'malformed' ? {} : { data: { user: null }, error: { status: 522 } });
  const response = await PATCH(makePatchRequest());
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual(expect.objectContaining({ code: 'AUTH_UNAVAILABLE' }));
  expect(mockAnonFrom).not.toHaveBeenCalled();
  expect(mockAdminFrom).not.toHaveBeenCalled(); expect(mockAdminRpc).not.toHaveBeenCalled();
  expect(writeAuditLog).not.toHaveBeenCalled();
});
test('membership transport exception never writes settings or records success', async () => {
  const chain = memberChain({ facility_id: FACILITY_UUID });
  chain.maybeSingle = jest.fn().mockRejectedValue(new Error('synthetic private dependency'));
  mockAnonFrom.mockReturnValue(chain);
  const response = await PATCH(makePatchRequest());
  expect(response.status).toBe(500); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.text()).not.toContain('synthetic private dependency');
  expect(mockAdminFrom).not.toHaveBeenCalled(); expect(mockAdminRpc).not.toHaveBeenCalled();
  expect(writeAuditLog).not.toHaveBeenCalled();
});
test('main-photo database update failure is not successful save', async () => {
  mockAnonFrom.mockReturnValue(memberChain({facility_id:FACILITY_UUID}));
  mockAdminFrom.mockReturnValue(memberChain({photo_url:'https://example.invalid/synthetic.png'}));
  mockAdminRpc.mockResolvedValue({data:null,error:{message:'08006'}});
  expect((await PATCH(makePatchRequest({photoId:'44444444-4444-4444-8444-444444444444'},
    {facility_id:FACILITY_UUID,action:'main-photo'}))).status).toBe(500);
  expect(writeAuditLog).not.toHaveBeenCalled();
});

test('PATCH: facility_id なし → 401', async () => {
  const res = await PATCH(makePatchRequest(VALID_BODY, {}));
  expect(res.status).toBe(401);
});

test('PATCH: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makePatchRequest());
  expect(res.status).toBe(429);
});

test('PATCH: 非管理者 → 401 (IDOR防止)', async () => {
  mockAnonFrom.mockReturnValue(memberChain(null));
  const res = await PATCH(makePatchRequest());
  expect(res.status).toBe(401);
});

// ─── Schema validation ────────────────────────────────────────────────────────

test('PATCH: name 空文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makePatchRequest({ name: '' }));
  expect(res.status).toBe(400);
});

test('PATCH: business_hours で close <= open → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makePatchRequest({
    name: 'test',
    business_hours: { mon: { open: '18:00', close: '09:00' } },
  }));
  expect(res.status).toBe(400);
});

test('PATCH: booking_buffer_minutes > 120 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makePatchRequest({ name: 'test', booking_buffer_minutes: 121 }));
  expect(res.status).toBe(400);
});

// ─── 医療広告ガイドライン（2026年7月28日 追加） ─────────────────────────────
// 施設の自由入力 PR 文言をそのまま公開すると、CareLink 自身が「広告を行った者」として
// 連帯責任を問われうる。事後モデレーションでは一度公開されてしまうため入口で拒否する。
test('PATCH: catch_copy に医療広告の禁止表現 → 400（公開前に拒否）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makePatchRequest({ name: 'test', catch_copy: '必ず治る施術です' }));
  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json.error).toContain('必ず治る');
});

test('PATCH: description に医療広告の禁止表現 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makePatchRequest({ name: 'test', description: '日本一の技術力' }));
  expect(res.status).toBe(400);
});

// 誤検知でまっとうな施設紹介を弾かないこと（弾きすぎも実害）。
test('PATCH: 通常の PR 文言は通る', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({
    name: 'test',
    catch_copy: '駅から徒歩5分、丁寧な施術が評判です',
    description: '国家資格を持つ施術者が担当します',
  }));
  expect(res.status).toBe(200);
});

// ─── Status action ────────────────────────────────────────────────────────────

test('PATCH: ?action=status published（必須項目充足）→ 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  publishMocks({ menu: 1, photo: 1, staff: 1 });
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('PATCH: 掲載のみはメニュー0件でも公開できる', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  publishMocks({ menu: null, photo: 1, staff: 1 });
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('PATCH: 掲載のみは写真0件でも公開できる', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  publishMocks({ menu: 1, photo: null, staff: 1 });
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('PATCH: 掲載のみはスタッフ0件でも公開できる', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  publishMocks({ menu: 1, photo: 1, staff: null });
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('PATCH: 掲載公開は予約用count queryを呼ばない', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  publishMocks({ countError: { message: 'count fail' } });
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  expect(res.status).toBe(200);
  expect(mockAdminFrom).not.toHaveBeenCalledWith('facility_menus');
});

test('PATCH: 掲載情報の読取失敗では公開を書き込まない', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  publishMocks({ profileError: { code: '08006' } });
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  expect(res.status).toBe(500);
  expect(writeAuditLog).not.toHaveBeenCalled();
});

test.each(['', ' \u3000 '])('PATCH: 住所 %p の施設は単独公開されない', async (address) => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  publishMocks({ menu: 1, photo: 1, staff: 1, address });
  const res = await PATCH(makePatchRequest({ status: 'published' }, { facility_id: FACILITY_UUID, action: 'status' }));
  const json = await res.json();
  expect(res.status).toBe(400);
  expect(json.missing).toEqual(['住所を設定してください']);
  expect(mockAdminFrom.mock.results.flatMap((result) => result.value.update?.mock.calls ?? [])).toEqual([]);
});

test('PATCH: ?action=status 無効なステータス → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makePatchRequest({ status: 'deleted' }, { facility_id: FACILITY_UUID, action: 'status' }));
  expect(res.status).toBe(400);
});

test('PATCH: ?action=status DB失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain({ message: 'DB error' }));
  const res = await PATCH(makePatchRequest({ status: 'suspended' }, { facility_id: FACILITY_UUID, action: 'status' }));
  expect(res.status).toBe(500);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test('PATCH: 正常更新 → 200 ok:true', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({ name: '更新施設', booking_auto_confirm: true }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('PATCH: DB更新失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain({ message: 'DB error' }));
  const res = await PATCH(makePatchRequest({ name: 'test' }));
  expect(res.status).toBe(500);
});

test('PATCH: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await PATCH(makePatchRequest());
  expect(res.status).toBe(403);
});

test('PATCH: writeAuditLog が呼ばれる', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const { writeAuditLog } = require('@/lib/audit-logger');
  await PATCH(makePatchRequest({ name: '施設名' }));
  await new Promise(r => setTimeout(r, 10));
  expect(writeAuditLog).toHaveBeenCalled();
});

test('PATCH: レートリミット params (20/60s)', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await PATCH(makePatchRequest({ name: '施設名' }));
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(20);
  expect(call[3]).toBe(60_000);
});

test('PATCH: ?action=status suspended → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({ status: 'suspended' }, { facility_id: FACILITY_UUID, action: 'status' }));
  expect(res.status).toBe(200);
});

test('PATCH: ?action=status draft → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({ status: 'draft' }, { facility_id: FACILITY_UUID, action: 'status' }));
  expect(res.status).toBe(200);
});

test('PATCH: website_url が有効URL → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({ name: '施設', website_url: 'https://example.com' }));
  expect(res.status).toBe(200);
});

// ─── 部分更新で website_url が消える回帰（2026年8月11日 恒久根治）───────────────
// spread の後ろに明示キーを置く旧実装だと、website_url を含まない保存で常に null 上書きされた。
// menus/[id]（並び替えで写真が消える）・features/[id]（トグルで画像が消える）と同じ形。
function captureSettingsUpdate() {
  const update = updateChain().update;
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue({ update });
  return update;
}

test('PATCH: website_url を送らない保存は website_url を書き換えない', async () => {
  const update = captureSettingsUpdate();
  const res = await PATCH(makePatchRequest({ name: '施設' }));
  expect(res.status).toBe(200);
  expect(Object.keys(update.mock.calls[0][0])).not.toContain('website_url');
});

test('PATCH: website_url に空文字を送ったときだけ null で消す', async () => {
  const update = captureSettingsUpdate();
  const res = await PATCH(makePatchRequest({ name: '施設', website_url: '' }));
  expect(res.status).toBe(200);
  expect(update.mock.calls[0][0]).toMatchObject({ website_url: null });
});

// ─── 政令指定都市の市区町村（2026年10月22日）─────────────────────────────────
// エリアページは city の完全一致でマスタ（src/data/city-slugs.ts）と結合する。「横浜市中区」「大阪市北区」の
// まま保存すると、その店舗はどのエリアページにも出なかった。
test.each([
  ['神奈川県', '横浜市中区', '山下町1', '横浜市', '中区山下町1'],
  ['大阪府', '大阪市北区', '梅田1-1-1', '北区', '梅田1-1-1'],
  ['大阪府', '大阪市', '北区梅田1-1-1', '北区', '梅田1-1-1'],
  ['大阪府', '堺市堺区', '南瓦町3-1', '堺市', '堺区南瓦町3-1'],
  ['東京都', '渋谷区', '東京都渋谷区道玄坂1', '渋谷区', '道玄坂1'],
])('PATCH: %s %s / %s をマスタ単位で保存する', async (prefecture, city, address, savedCity, savedAddress) => {
  const update = captureSettingsUpdate();
  const res = await PATCH(makePatchRequest({ name: '施設', prefecture, city, address }));
  expect(res.status).toBe(200);
  expect(update.mock.calls[0][0]).toMatchObject({ prefecture, city: savedCity, address: savedAddress });
  // 画面が入力欄を実際に保存された値へ合わせられるように返す。
  expect(await res.json()).toEqual({ ok: true, location: { city: savedCity, address: savedAddress } });
});

test('PATCH: 番地が空なら区を番地へ移さない（区だけの住所「中区」を作らない）', async () => {
  const update = captureSettingsUpdate();
  const res = await PATCH(makePatchRequest({ name: '施設', prefecture: '神奈川県', city: '横浜市中区', address: '' }));
  expect(res.status).toBe(200);
  expect(update.mock.calls[0][0]).toMatchObject({ city: '横浜市中区', address: '' });
});

test('PATCH: 下書きで住所欄が都道府県・市区町村だけなら、番地を空にして保存できる', async () => {
  const update = captureSettingsUpdate();
  const res = await PATCH(makePatchRequest({ name: '施設', prefecture: '東京都', city: '渋谷区', address: '東京都渋谷区' }));
  expect(res.status).toBe(200);
  expect(update.mock.calls[0][0]).toMatchObject({ city: '渋谷区', address: '' });
  expect(await res.json()).toEqual({ ok: true, location: { city: '渋谷区', address: '' } });
});

// 公開中の施設で住所欄が「大阪府大阪市北区」だけだった（取り込み時の旧データ）場合、揃えると番地が空になり
// DB が拒否する。店舗は住所を消していないので「先に非公開へ」ではなく、番地の入力を案内する。
test('PATCH: 公開中で住所欄が都道府県・市区町村だけなら、番地の入力を求める 400（非公開を求めない）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain(locationConflict));
  const res = await PATCH(makePatchRequest({ name: '施設', prefecture: '大阪府', city: '大阪市北区', address: '大阪府大阪市北区' }));
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error).toContain('番地（町名以降）まで入力');
  expect(body.error).not.toContain('非公開');
});

test('PATCH: 市区町村だけの保存は番地を推測せず、所在地を書き換えない', async () => {
  const update = captureSettingsUpdate();
  const res = await PATCH(makePatchRequest({ name: '施設', city: '横浜市中区' }));
  expect(res.status).toBe(200);
  expect(update.mock.calls[0][0]).toMatchObject({ city: '横浜市中区' });
  expect(Object.keys(update.mock.calls[0][0])).not.toContain('address');
  expect(await res.json()).toEqual({ ok: true });
});

test('PATCH: booking_buffer_minutes が 120 (上限ぴったり) → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({ name: '施設', booking_buffer_minutes: 120 }));
  expect(res.status).toBe(200);
});

test('PATCH: board_slot_minutes が許可外(45) → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makePatchRequest({ name: '施設', board_slot_minutes: 45 }));
  expect(res.status).toBe(400);
});

test('PATCH: board_slot_minutes が許可値(30) → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({ name: '施設', board_slot_minutes: 30 }));
  expect(res.status).toBe(200);
});

test('PATCH: business_hours の hours が null → ループスキップして 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({
    name: 'test',
    business_hours: { sun: null, mon: { open: '09:00', close: '18:00' } },
  }));
  expect(res.status).toBe(200);
});

test('PATCH: business_hours が valid (close > open) → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makePatchRequest({
    name: 'test',
    business_hours: { mon: { open: '09:00', close: '18:00' } },
  }));
  expect(res.status).toBe(200);
});

// 2026年10月23日: 予約枠は営業時間の中にしか出ない。勤務時間を保存したスタッフがいても、誰の勤務も
// 保存した営業時間と重ならなければ、保存は成功に見えるのに予約画面は毎日「満枠」になる。注意だけ返す。
describe('営業時間を保存したとき、勤務が重なるスタッフがいなければ注意を返す（保存は止めない）', () => {
  const thenable = (data: unknown, error: unknown = null) => {
    const obj: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'gte', 'not', 'limit']) obj[method] = jest.fn(() => obj);
    obj.then = (resolve: (v: unknown) => unknown) => resolve({ data, error });
    return obj;
  };
  const staffRows = (start: string, end: string) => [{ id: 's1', staff_schedules: [{ day_of_week: 1, start_time: start, end_time: end }], schedule_overrides: [] }];
  const savedHours = { mon: { open: '10:00', close: '18:00' } };
  const mockReads = (rows: unknown, staffError: unknown = null) => {
    mockAdminFrom.mockImplementation((table: string) => table === 'staff_profiles' ? thenable(rows, staffError)
      : table === 'facility_profiles' ? { ...thenable([{ business_hours: savedHours }]), ...updateChain() } : updateChain());
  };
  beforeEach(() => { mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID })); });

  test('勤務がすべて営業時間の外なら注意を返す', async () => {
    mockReads(staffRows('07:00:00', '10:00:00'));
    const res = await PATCH(makePatchRequest({ name: 'test', business_hours: savedHours }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, warning: '保存した営業時間と重なる勤務時間のスタッフがいないため、ネット予約の枠が出ません。スタッフの勤務時間を見直してください。' });
  });
  test('重なる勤務のスタッフがいれば注意しない', async () => {
    mockReads(staffRows('09:00:00', '12:00:00'));
    expect(await (await PATCH(makePatchRequest({ name: 'test', business_hours: savedHours }))).json()).toEqual({ ok: true });
  });
  test('勤務時間を保存したスタッフがいなければ（別の案内が出るので）注意しない', async () => {
    mockReads([{ id: 's1', staff_schedules: [], schedule_overrides: [] }]);
    expect(await (await PATCH(makePatchRequest({ name: 'test', business_hours: savedHours }))).json()).toEqual({ ok: true });
  });
  test('スタッフを読めなければ注意を出さず、保存は成功のまま', async () => {
    mockReads(null, { message: 'down' });
    const res = await PATCH(makePatchRequest({ name: 'test', business_hours: savedHours }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
  test('営業時間を含まない保存ではスタッフを読まない', async () => {
    mockReads(staffRows('07:00:00', '10:00:00'));
    expect(await (await PATCH(makePatchRequest({ name: 'test' }))).json()).toEqual({ ok: true });
    expect(mockAdminFrom.mock.calls.map(([table]) => table)).not.toContain('staff_profiles');
  });
});

test('PATCH: business_hours の未知キー（曜日以外）は strip されDB更新に乗らない', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const updateFn = updateChain().update;
  mockAdminFrom.mockReturnValue({ update: updateFn });
  const res = await PATCH(makePatchRequest({
    name: 'test',
    business_hours: { mon: { open: '09:00', close: '18:00' }, evil: { open: '00:00', close: '23:59' }, foo: { open: '01:00', close: '02:00' } },
  }));
  expect(res.status).toBe(200);
  const payload = updateFn.mock.calls[0][0];
  expect(payload.business_hours).toEqual({ mon: { open: '09:00', close: '18:00' } });
  expect(payload.business_hours.evil).toBeUndefined();
  expect(payload.business_hours.foo).toBeUndefined();
});

test('PATCH: 不正JSON → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const url = new URL('http://localhost/api/admin/settings');
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await PATCH(req);
  expect(res.status).toBe(400);
});

test('PATCH: facility_id が不正UUID → 401', async () => {
  const res = await PATCH(makePatchRequest(VALID_BODY, { facility_id: 'bad-uuid' }));
  expect(res.status).toBe(401);
});

describe('保存した行の確認と依存障害', () => {
  test.each([null, undefined, {}, { id: USER_ID }])('通常保存の欠損・別施設応答を成功にしない %#', async data => {
    mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
    const chain = updateChain();
    chain.update.mockReturnValue({ eq: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data, error: null }) }),
    }) });
    mockAdminFrom.mockReturnValue(chain);
    const res = await PATCH(makePatchRequest());
    expect(res.status).toBe(409);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  test.each(['published', 'draft', 'suspended'])('status=%sの0行更新を成功・監査にしない', async status => {
    mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
    publishMocks();
    const original = mockAdminFrom.getMockImplementation()!;
    mockAdminFrom.mockImplementation(table => {
      const chain = original(table);
      if (table === 'facility_profiles') chain.update = updateChain(null, null).update;
      return chain;
    });
    const res = await PATCH(makePatchRequest({ status }, { facility_id: FACILITY_UUID, action: 'status' }));
    expect(res.status).toBe(409);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  test('認可照会のerrorとdataが併存しても書き込まない', async () => {
    mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }, { message: 'synthetic private detail' }));
    const res = await PATCH(makePatchRequest());
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('synthetic private detail');
    expect(mockAdminFrom).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  test('異なる施設のmembership応答を信用しない', async () => {
    mockAnonFrom.mockReturnValue(memberChain({ facility_id: USER_ID }));
    expect((await PATCH(makePatchRequest())).status).toBe(401);
    expect(mockAdminFrom).not.toHaveBeenCalled();
  });

  test('Auth通信例外は固定503へ復帰し成功監査しない', async () => {
    mockGetUser.mockRejectedValueOnce(new Error('synthetic private detail'));
    const res = await PATCH(makePatchRequest());
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).not.toContain('synthetic private detail');
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

// ─── 欄ごとのエラー（2026年10月23日）──────────────────────────────────────────
// 以前は Web サイト欄に www.example.com と書くだけで保存全体が「リクエストが不正です」で失敗し、
// 住所・営業時間も保存されず、どの欄が悪いのかも分からなかった。
test('PATCH: スキームの無い Web サイトは https:// を補って保存する', async () => {
  const update = captureSettingsUpdate();
  const res = await PATCH(makePatchRequest({ name: '施設', website_url: ' www.example.com ' }));
  expect(res.status).toBe(200);
  expect(update.mock.calls[0][0]).toMatchObject({ website_url: 'https://www.example.com' });
});

test.each(['javascript://example.com/%0aalert(1)', 'ftp://example.com', 'https://'])('PATCH: http(s) でない・壊れた Web サイト %s は欄名つきで断る', async (url) => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makePatchRequest({ name: '施設', website_url: url }));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({
    error: '入力内容を確認してください：Webサイト',
    fields: { website_url: 'WebサイトのURLを確認してください（例: https://example.com）' },
  });
});

test('PATCH: 複数の欄が不正なら、それぞれの欄名を返す', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makePatchRequest({ name: '', seat_count: -1 }));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({
    error: '入力内容を確認してください：施設名、席数',
    fields: { name: '施設名の入力内容を確認してください', seat_count: '席数の入力内容を確認してください' },
  });
});

test.each([
  ['catch_copy', 'キャッチコピー：'],
  ['description', '施設紹介：'],
])('PATCH: 医療広告の表現で断るときは、どの欄か（%s）を先頭に示す', async (field, prefix) => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makePatchRequest({ name: 'test', [field]: '必ず治る施術です' }));
  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json.error.startsWith(prefix)).toBe(true);
  expect(json.fields).toEqual({ [field]: json.error });
});

test('PATCH: 閉店が開店より前の営業時間は営業時間の欄として返す', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makePatchRequest({ name: 'test', business_hours: { mon: { open: '18:00', close: '10:00' } } }));
  expect(res.status).toBe(400);
  expect((await res.json()).fields).toEqual({ business_hours: '月曜日の閉店時間は開店時間より後にしてください' });
});
