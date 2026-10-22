/**
 * @jest-environment node
 *
 * POST /api/preferred-staff（指名スタッフの登録・解除）
 * - CSRF・レート制限・ログイン必須（withRoute）
 * - 登録できるのは「公開施設の在籍スタッフ」だけ（RLS は自分の行かしか見ないため、ここで確かめる）
 * - 二重登録（23505）は登録済みとして成功、解除はスタッフの状態に関係なくできる
 * - DB 障害は 500（通知つき）で、成功に化けない
 */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({ mutationRateLimit: 'mutationLimit', checkRateLimit: jest.fn() }));
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: jest.fn() }));

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { POST } from '../route';

const STAFF = '11111111-1111-4111-8111-111111111111';
const FACILITY = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

type Result = { data?: unknown; error?: { code?: string; message: string } | null };
interface Call { table: string; op: string; filters: Array<[string, unknown]>; payload?: unknown }

let calls: Call[];
let results: Record<string, Result>;
let user: { id: string } | null;

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: [] };
  calls.push(call);
  const settle = () => Promise.resolve({ data: null, error: null, ...results[`${table}.${call.op}`] });
  const b: Record<string, unknown> = {
    select: () => b,
    delete: () => { call.op = 'delete'; return b; },
    insert: (payload: unknown) => { call.op = 'insert'; call.payload = payload; return settle(); },
    eq: (col: string, value: unknown) => { call.filters.push([col, value]); return b; },
    maybeSingle: settle,
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => settle().then(resolve, reject),
  };
  return b;
}

beforeEach(() => {
  jest.clearAllMocks();
  calls = [];
  user = { id: USER };
  results = {
    'staff_profiles.select': { data: { id: STAFF, facility_id: FACILITY } },
    'facility_profiles.select': { data: { id: FACILITY } },
  };
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  (createServerSupabaseAuthClient as jest.Mock).mockImplementation(async () => ({
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from: (table: string) => builder(table),
  }));
});

function post(body: unknown) {
  return POST(new Request('http://localhost/api/preferred-staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
}

const writes = () => calls.filter((c) => c.table === 'user_preferred_staff');

describe('POST /api/preferred-staff', () => {
  test('CSRF に失敗したら何もしない', async () => {
    (checkCsrf as jest.Mock).mockReturnValueOnce(new Response('{}', { status: 403 }));
    expect((await post({ staffId: STAFF, nominated: true })).status).toBe(403);
    expect(calls).toEqual([]);
  });

  test('レート制限中は 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValueOnce(true);
    expect((await post({ staffId: STAFF, nominated: true })).status).toBe(429);
    expect(checkRateLimit).toHaveBeenCalledWith('mutationLimit', expect.any(String), 20, 60_000, 'preferred-staff');
  });

  test('未ログインは 401 で書き込まない', async () => {
    user = null;
    expect((await post({ staffId: STAFF, nominated: true })).status).toBe(401);
    expect(writes()).toEqual([]);
  });

  test.each([
    ['JSON でない', 'not json'],
    ['配列', [STAFF]],
    ['null', null],
    ['staffId が無い', { nominated: true }],
    ['staffId が UUID でない', { staffId: 'staff-1', nominated: true }],
    ['nominated が無い', { staffId: STAFF }],
    ['nominated が文字列', { staffId: STAFF, nominated: 'true' }],
  ])('入力が不正（%s）なら 400 で書き込まない', async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual(expect.any(String));
    expect(writes()).toEqual([]);
  });

  test('公開施設の在籍スタッフを本人の行として登録する', async () => {
    const res = await post({ staffId: STAFF, nominated: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ nominated: true });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(calls.find((c) => c.table === 'staff_profiles')!.filters).toEqual([['id', STAFF], ['is_active', true]]);
    expect(calls.find((c) => c.table === 'facility_profiles')!.filters).toEqual([['id', FACILITY], ['status', 'published']]);
    expect(writes()).toEqual([{ table: 'user_preferred_staff', op: 'insert', filters: [], payload: { user_id: USER, staff_id: STAFF } }]);
  });

  test('登録済み（UNIQUE 違反 23505）は登録済みとして成功を返す', async () => {
    results['user_preferred_staff.insert'] = { error: { code: '23505', message: 'duplicate key' } };
    const res = await post({ staffId: STAFF, nominated: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ nominated: true });
  });

  test('非表示（is_active=false）や存在しないスタッフは 404 で登録しない', async () => {
    results['staff_profiles.select'] = { data: null };
    const res = await post({ staffId: STAFF, nominated: true });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('このスタッフは現在指名登録できません');
    expect(calls.some((c) => c.table === 'facility_profiles')).toBe(false);
    expect(writes()).toEqual([]);
  });

  test('非公開施設のスタッフは 404 で登録しない', async () => {
    results['facility_profiles.select'] = { data: null };
    expect((await post({ staffId: STAFF, nominated: true })).status).toBe(404);
    expect(writes()).toEqual([]);
  });

  test.each([
    ['スタッフの確認', 'staff_profiles.select'],
    ['施設の確認', 'facility_profiles.select'],
    ['登録', 'user_preferred_staff.insert'],
  ])('%sで DB 障害が起きたら 500 にして成功に化けさせない', async (_label, key) => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    results[key] = { data: null, error: { code: '57014', message: 'timeout' } };
    const res = await post({ staffId: STAFF, nominated: true });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('指名登録できませんでした。時間をおいて再度お試しください。');
    errorSpy.mockRestore();
  });

  test('解除は本人の行だけを消し、スタッフの状態を問わない', async () => {
    results['staff_profiles.select'] = { data: null };
    const res = await post({ staffId: STAFF, nominated: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ nominated: false });
    expect(calls.some((c) => c.table === 'staff_profiles')).toBe(false);
    expect(writes()).toEqual([{ table: 'user_preferred_staff', op: 'delete', filters: [['user_id', USER], ['staff_id', STAFF]] }]);
  });

  test('解除で DB 障害が起きたら 500', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    results['user_preferred_staff.delete'] = { error: { message: 'down' } };
    const res = await post({ staffId: STAFF, nominated: false });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('指名を解除できませんでした。時間をおいて再度お試しください。');
    errorSpy.mockRestore();
  });
});
