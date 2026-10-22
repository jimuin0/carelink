/**
 * @jest-environment node
 *
 * 口コミへの返信の公開（POST /api/admin/review-replies）。
 * 書き込みは service_role の RPC 1 回だけで、権限（その店舗の owner / admin か）と口コミの所属は
 * RPC が書き込みと同じトランザクションで確かめる。ここではルートの外形（CSRF・レート制限・
 * ログイン・入力・RPC の結果の扱い・監査ログ）を固定する。
 */
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(), getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
const mockAlert = jest.fn();
jest.mock('@/lib/alert', () => ({ alertCaughtError: (...args: unknown[]) => mockAlert(...args) }));
jest.mock('@/lib/safe', () => ({ ...jest.requireActual('@/lib/safe'), safeCaptureException: jest.fn() }));
const mockGetUser = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: async () => ({ auth: { getUser: mockGetUser } }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ rpc: mockRpc }) }));
import { POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';
import { writeAuditLog } from '@/lib/audit-logger';

const facilityId = '73000000-0000-4000-8000-000000000001';
const reviewId = '73000000-0000-4000-8000-000000000002';
const replyId = '73000000-0000-4000-8000-000000000003';
const userId = '73000000-0000-4000-8000-000000000004';
const created = { id: replyId, review_id: reviewId, content: 'ご来店ありがとうございました', created_at: '2026-10-22T01:00:00Z' };

function request(body: unknown = { review_id: reviewId, content: '  ご来店ありがとうございました  ' }, fid: string | null = facilityId) {
  return new Request(`http://localhost/api/admin/review-replies${fid === null ? '' : `?facility_id=${fid}`}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  mockRpc.mockResolvedValue({ data: [created], error: null });
});

test('検証済みの本人・店舗・口コミ・前後の空白を除いた本文で RPC を 1 回呼び、公開した返信を返す', async () => {
  const res = await POST(request());
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ reply: created });
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith('create_review_reply_atomic', {
    p_actor_id: userId, p_facility_id: facilityId, p_review_id: reviewId, p_content: 'ご来店ありがとうございました',
  });
  expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
    userId, facilityId, action: 'create', tableName: 'review_replies', recordId: replyId,
    newValues: { review_id: reviewId, content: created.content }, ipAddress: '127.0.0.1', userAgent: 'test',
  }));
});

test('本文の大文字 UUID 指定でも、小文字で返る結果を同じ口コミとして受け付ける', async () => {
  const res = await POST(request({ review_id: reviewId.toUpperCase(), content: 'x' }));
  expect(res.status).toBe(201);
});

test.each([
  ['42501', 403, '店舗の管理権限を確認してください'],
  ['23505', 409, 'この口コミには既に返信があります。画面を再読み込みしてください'],
  ['22023', 400, '返信は1〜500文字で入力してください'],
])('RPC の %s は %i で、公開の監査ログを残さない', async (code, status, message) => {
  mockRpc.mockResolvedValue({ data: null, error: { code, message: 'private detail' } });
  const res = await POST(request());
  expect(res.status).toBe(status);
  expect(await res.json()).toEqual({ error: message });
  expect(writeAuditLog).not.toHaveBeenCalled();
  expect(mockAlert).not.toHaveBeenCalled();
});

test('想定外の DB エラーは通知つきの 500', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'private detail' } });
  const res = await POST(request());
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: '返信を公開できませんでした' });
  expect(mockAlert).toHaveBeenCalledTimes(1);
  expect(writeAuditLog).not.toHaveBeenCalled();
});

test('自店の口コミでなければ 0 行＝404（他店の口コミには返信できない）', async () => {
  mockRpc.mockResolvedValue({ data: [], error: null });
  const res = await POST(request());
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'この店舗の口コミが見つかりません。画面を再読み込みしてください' });
  expect(writeAuditLog).not.toHaveBeenCalled();
});

test.each([
  ['null', null],
  ['複数行', [created, created]],
  ['別の口コミへの返信', [{ ...created, review_id: facilityId }]],
  ['形が違う', [{ ...created, content: 1 }]],
])('結果が確認できない（%s）なら成功にせず通知つきの 500', async (_label, data) => {
  mockRpc.mockResolvedValue({ data, error: null });
  const res = await POST(request());
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: '返信の公開を確認できませんでした。画面を再読み込みしてください' });
  expect(mockAlert).toHaveBeenCalledTimes(1);
  expect(writeAuditLog).not.toHaveBeenCalled();
});

test('RPC の通信失敗は 500 で、成功の監査ログを残さない', async () => {
  mockRpc.mockRejectedValue(new Error('synthetic'));
  expect((await POST(request())).status).toBe(500);
  expect(writeAuditLog).not.toHaveBeenCalled();
});

test.each([null, 'bad-id'])('店舗 ID が無い・不正（%s）は RPC の前に 400', async (fid) => {
  const res = await POST(request(undefined, fid));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: '店舗IDが不正です' });
  expect(mockRpc).not.toHaveBeenCalled();
});

test.each([
  ['空白だけ', { review_id: reviewId, content: '   ' }, '返信は1〜500文字で入力してください'],
  ['501 文字', { review_id: reviewId, content: 'あ'.repeat(501) }, '返信は1〜500文字で入力してください'],
  ['口コミ ID が不正', { review_id: 'bad', content: 'x' }, 'リクエストが不正です'],
  ['JSON でない', '{', 'リクエストが不正です'],
])('%s は RPC の前に 400', async (_label, body, message) => {
  const res = await POST(request(body));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: message });
  expect(mockRpc).not.toHaveBeenCalled();
});

test('未ログインは 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await POST(request())).status).toBe(401);
  expect(mockRpc).not.toHaveBeenCalled();
});

test('認証基盤の障害は 503 で書き込まない', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: { status: 522 } });
  expect((await POST(request())).status).toBe(503);
  expect(mockRpc).not.toHaveBeenCalled();
});

test('レート制限は 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  expect((await POST(request())).status).toBe(429);
  expect(checkRateLimit).toHaveBeenCalledWith(null, expect.any(String), 30, 60_000, 'admin-review-replies');
  expect(mockRpc).not.toHaveBeenCalled();
});

test('CSRF の拒否はそのまま返し、書き込まない', async () => {
  const rejected = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValue(rejected);
  expect(await POST(request())).toBe(rejected);
  expect(mockRpc).not.toHaveBeenCalled();
});
