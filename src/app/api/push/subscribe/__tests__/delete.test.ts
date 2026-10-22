/**
 * @jest-environment node
 *
 * DELETE /api/push/subscribe（この端末のプッシュ通知を解除・2026年10月22日 新設）。
 *   - CSRF・レート制限・ログイン必須（withRoute）
 *   - 消すのは呼び出した本人の行のうち、送られてきた endpoint と一致するものだけ
 *     （1 人 1 端末なので、別の端末で登録し直した後の古い画面から新しい端末を消さない）
 */
const mockCheckCsrf = jest.fn();
const mockCheckRateLimit = jest.fn();
const mockGetUser = jest.fn();
const mockEqUser = jest.fn();
const mockEqEndpoint = jest.fn();
const mockDeleteSelect = jest.fn();
const mockFrom = jest.fn();

jest.mock('@/lib/csrf', () => ({ checkCsrf: (...a: unknown[]) => mockCheckCsrf(...a) }));
jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: 'mutationLimit',
  checkRateLimit: (...a: unknown[]) => mockCheckRateLimit(...a),
}));
jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: async () => ({ auth: { getUser: () => mockGetUser() } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: (table: string) => mockFrom(table) }),
  createServerSupabaseClient: jest.fn(),
}));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));

import { NextResponse } from 'next/server';
import { DELETE } from '../route';

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/synthetic-device';

function request(body: unknown) {
  return new Request('http://localhost/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckCsrf.mockReturnValue(null);
  mockCheckRateLimit.mockResolvedValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null });
  mockDeleteSelect.mockResolvedValue({ data: [{ id: 'sub-1' }], error: null });
  mockEqEndpoint.mockReturnValue({ select: mockDeleteSelect });
  mockEqUser.mockReturnValue({ eq: mockEqEndpoint });
  mockFrom.mockReturnValue({ delete: () => ({ eq: mockEqUser }) });
});

test('本人の行のうち、この端末の endpoint と一致するものだけを消す', async () => {
  const res = await DELETE(request({ endpoint: ENDPOINT }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, removed: 1 });
  expect(mockFrom).toHaveBeenCalledWith('push_subscriptions');
  expect(mockEqUser).toHaveBeenCalledWith('user_id', 'user-123');
  expect(mockEqEndpoint).toHaveBeenCalledWith('endpoint', ENDPOINT);
});

test('一致する行が無ければ何も消さず removed=0（別の端末で登録し直した後など）', async () => {
  mockDeleteSelect.mockResolvedValue({ data: [], error: null });
  const res = await DELETE(request({ endpoint: ENDPOINT }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, removed: 0 });
});

test('data が null でも removed=0 として扱う', async () => {
  mockDeleteSelect.mockResolvedValue({ data: null, error: null });
  expect(await (await DELETE(request({ endpoint: ENDPOINT }))).json()).toEqual({ ok: true, removed: 0 });
});

test('未ログインは 401 で何も消さない', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  const res = await DELETE(request({ endpoint: ENDPOINT }));
  expect(res.status).toBe(401);
  expect(mockFrom).not.toHaveBeenCalled();
});

test('CSRF 検証に失敗したら何も消さない', async () => {
  mockCheckCsrf.mockReturnValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }));
  const res = await DELETE(request({ endpoint: ENDPOINT }));
  expect(res.status).toBe(403);
  expect(mockFrom).not.toHaveBeenCalled();
});

test('レート制限を超えたら 429 で何も消さない', async () => {
  mockCheckRateLimit.mockResolvedValue(true);
  const res = await DELETE(request({ endpoint: ENDPOINT }));
  expect(res.status).toBe(429);
  expect(mockCheckRateLimit).toHaveBeenCalledWith('mutationLimit', expect.any(String), 10, 60_000, 'rl:push-unsub');
  expect(mockFrom).not.toHaveBeenCalled();
});

test.each([
  ['JSON でない', 'not-json'],
  ['null', null],
  ['endpoint なし', {}],
  ['文字列でない', { endpoint: 123 }],
  ['https でない', { endpoint: 'http://fcm.googleapis.com/x' }],
  ['長すぎる', { endpoint: `https://fcm.googleapis.com/${'a'.repeat(2048)}` }],
])('endpoint が不正（%s）なら 400 で何も消さない', async (_label, body) => {
  const res = await DELETE(request(body === null ? 'null' : body));
  expect(res.status).toBe(400);
  expect(mockFrom).not.toHaveBeenCalled();
});

test('削除の失敗は 500（成功に見せない）', async () => {
  mockDeleteSelect.mockResolvedValue({ data: null, error: { message: 'db down' } });
  const res = await DELETE(request({ endpoint: ENDPOINT }));
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: '通知の解除に失敗しました' });
});
