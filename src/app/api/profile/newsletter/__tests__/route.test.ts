/**
 * @jest-environment node
 *
 * PUT /api/profile/newsletter（マイページ「お知らせメールを受け取る」）
 * - CSRF・レート制限・ログイン必須
 * - 切り替えは profiles の旗と配信停止の抑止行を 1 トランザクションで扱う RPC だけを通す
 *   （ブラウザ／service_role から profiles を直接書き換えない）
 * - 宛先は本人のアカウント（ctx.user.id）だけ。リクエストから宛先・ユーザーを指定させない
 */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: 'mutationLimit',
  checkRateLimit: jest.fn(),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: jest.fn(),
  createServerSupabaseClient: jest.fn(),
}));
jest.mock('@supabase/ssr');
jest.mock('next/headers');

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { PUT } from '../route';

const mockRpc = jest.fn();
const mockFrom = jest.fn();
let mockGetUser: jest.Mock;

function setup(hasUser = true) {
  mockGetUser = jest.fn().mockResolvedValue({ data: { user: hasUser ? { id: 'user-123' } : null } });
  const { createServerClient } = require('@supabase/ssr');
  createServerClient.mockReturnValue({ auth: { getUser: mockGetUser }, from: mockFrom });
  (createServiceRoleClient as jest.Mock).mockReturnValue({ rpc: mockRpc, from: mockFrom });
  const { cookies } = require('next/headers');
  cookies.mockResolvedValue({ getAll: jest.fn(() => []), set: jest.fn() });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
}

function request(body: unknown) {
  return new Request('http://localhost/api/profile/newsletter', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.168.1.1' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  mockRpc.mockImplementation(async (_name: string, args: { p_receive: boolean }) => ({
    data: { success: true, receive: args.p_receive, cleared: 1, reactivated: 0 }, error: null,
  }));
  setup();
});

test.each([true, false])('receive=%p は本人の id で RPC を 1 回だけ呼び、profiles を直接書き換えない', async (receive) => {
  const res = await PUT(request({ receive }) as any);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: true, receive });
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith('set_newsletter_preference_atomic', { p_user_id: 'user-123', p_receive: receive });
  expect(mockFrom).not.toHaveBeenCalled();
});

test('CSRF 不一致 → 403・RPC は呼ばない', async () => {
  (checkCsrf as jest.Mock).mockReturnValue(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await PUT(request({ receive: true }) as any);
  expect(res.status).toBe(403);
  expect(mockRpc).not.toHaveBeenCalled();
});

test('レート制限 → 429', async () => {
  (checkRateLimit as jest.Mock).mockResolvedValue(true);
  const res = await PUT(request({ receive: true }) as any);
  expect(res.status).toBe(429);
  expect(mockRpc).not.toHaveBeenCalled();
});

test('未ログイン → 401', async () => {
  setup(false);
  const res = await PUT(request({ receive: true }) as any);
  expect(res.status).toBe(401);
  expect(mockRpc).not.toHaveBeenCalled();
});

test.each([
  ['壊れた JSON', 'invalid {'],
  ['receive が無い', {}],
  ['receive が文字列', { receive: 'true' }],
  ['宛先やユーザーを指定させない', { receive: true, email: 'someone@example.invalid' }],
  ['ユーザー id を指定させない', { receive: true, user_id: 'other-user' }],
])('%s → 400・RPC は呼ばない', async (_label, body) => {
  const res = await PUT(request(body) as any);
  expect(res.status).toBe(400);
  expect(mockRpc).not.toHaveBeenCalled();
});

test('プロフィールが無い → 409（設定は変わっていないと伝える）', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { code: 'P0002', message: 'NEWSLETTER_PREFERENCE_PROFILE_MISSING' } });
  const res = await PUT(request({ receive: true }) as any);
  expect(res.status).toBe(409);
  expect((await res.json()).error).toContain('設定は変更されていません');
});

test('RPC の失敗 → 500（成功に見せない）', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { code: '40001', message: 'serialization failure' } });
  const res = await PUT(request({ receive: true }) as any);
  expect(res.status).toBe(500);
  expect((await res.json()).error).toBe('設定の変更に失敗しました');
});

test.each([
  ['形の違う応答', { ok: true }],
  ['null', null],
  ['逆向きの結果', { success: true, receive: false }],
])('%s → 500（結果を確認できないものを成功にしない）', async (_label, data) => {
  mockRpc.mockResolvedValue({ data, error: null });
  const res = await PUT(request({ receive: true }) as any);
  expect(res.status).toBe(500);
});
