/**
 * @jest-environment node
 *
 * 口コミへの返信の編集（PATCH）と削除（DELETE）＝ /api/admin/review-replies/[id]。
 * どちらも service_role の RPC 1 回だけで書き、権限（その店舗の owner / admin か）と
 * 返信の所属（その店舗の口コミに付いた返信か）は RPC が書き込みと同じトランザクションで確かめる。
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
import { DELETE, PATCH } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';
import { writeAuditLog } from '@/lib/audit-logger';

const facilityId = '74000000-0000-4000-8000-000000000001';
const reviewId = '74000000-0000-4000-8000-000000000002';
const replyId = '74000000-0000-4000-8000-000000000003';
const userId = '74000000-0000-4000-8000-000000000004';
const updated = {
  id: replyId, review_id: reviewId, content: '修正した返信です', created_at: '2026-10-22T01:00:00Z',
  previous_content: '最初の返信です',
};
const deleted = { id: replyId, review_id: reviewId, content: '消す返信です' };

function request(method: 'PATCH' | 'DELETE', body?: unknown, fid: string | null = facilityId) {
  return new Request(`http://localhost/api/admin/review-replies/${replyId}${fid === null ? '' : `?facility_id=${fid}`}`, {
    method,
    ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  });
}
const props = (id = replyId) => ({ params: Promise.resolve({ id }) });
const patch = (body: unknown = { content: '  修正した返信です  ' }, fid?: string | null, id?: string) =>
  PATCH(request('PATCH', body, fid), props(id));
const remove = (fid?: string | null, id?: string) => DELETE(request('DELETE', undefined, fid), props(id));

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
});

describe('PATCH（編集）', () => {
  beforeEach(() => mockRpc.mockResolvedValue({ data: [updated], error: null }));

  test('本人・店舗・返信・前後の空白を除いた本文で RPC を 1 回呼び、書き換え前後を監査ログに残す', async () => {
    const res = await patch();
    expect(res.status).toBe(200);
    // 画面には書き換え前の本文（監査用）を返さない
    expect(await res.json()).toEqual({
      reply: { id: replyId, review_id: reviewId, content: '修正した返信です', created_at: '2026-10-22T01:00:00Z' },
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('update_review_reply_atomic', {
      p_actor_id: userId, p_facility_id: facilityId, p_reply_id: replyId, p_content: '修正した返信です',
    });
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      userId, facilityId, action: 'update', tableName: 'review_replies', recordId: replyId,
      oldValues: { content: '最初の返信です' }, newValues: { content: '修正した返信です' },
    }));
  });

  test.each([
    ['42501', 'REVIEW_REPLY_FORBIDDEN', 403, '店舗の管理権限を確認してください'],
    ['22023', 'REVIEW_REPLY_INVALID', 400, '返信は1〜500文字で入力してください'],
  ])('RPC の %s（%s）は %i で、監査ログを残さない', async (code, rpcMessage, status, message) => {
    mockRpc.mockResolvedValue({ data: null, error: { code, message: rpcMessage } });
    const res = await patch();
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: message });
    expect(writeAuditLog).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  test('RPC の実行権が欠けた 42501（設定ミス）は通知つきの 500', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for function update_review_reply_atomic' } });
    const res = await patch();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: '返信を更新できませんでした' });
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  test('想定外の DB エラーは通知つきの 500', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '57014' } });
    const res = await patch();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: '返信を更新できませんでした' });
    expect(mockAlert).toHaveBeenCalledTimes(1);
  });

  test('自店の口コミの返信でなければ 0 行＝404（他店の返信は書き換えられない）', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const res = await patch();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'この返信は見つかりません。画面を再読み込みしてください' });
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  test.each([
    ['別の返信', [{ ...updated, id: reviewId }]],
    ['書き換え前の本文が無い', [{ ...updated, previous_content: undefined }]],
    ['複数行', [updated, updated]],
  ])('結果が確認できない（%s）なら成功にせず通知つきの 500', async (_label, data) => {
    mockRpc.mockResolvedValue({ data, error: null });
    const res = await patch();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: '返信の更新を確認できませんでした。画面を再読み込みしてください' });
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  test.each([
    ['空白だけ', { content: '  ' }, '返信は1〜500文字で入力してください'],
    ['501 文字', { content: 'あ'.repeat(501) }, '返信は1〜500文字で入力してください'],
    ['JSON でない', '{', 'リクエストが不正です'],
  ])('%s は RPC の前に 400', async (_label, body, message) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: message });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test.each([[null, replyId], ['bad', replyId], [facilityId, 'bad-id']])('店舗 %s・返信 %s が不正なら 400', async (fid, id) => {
    const res = await patch(undefined, fid, id);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: '店舗・返信IDが不正です' });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('DELETE（削除）', () => {
  beforeEach(() => mockRpc.mockResolvedValue({ data: [deleted], error: null }));

  test('本人・店舗・返信で RPC を 1 回呼び、消した本文を監査ログに残す', async () => {
    const res = await remove();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, replyId });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('delete_review_reply_atomic', {
      p_actor_id: userId, p_facility_id: facilityId, p_reply_id: replyId,
    });
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      userId, facilityId, action: 'delete', tableName: 'review_replies', recordId: replyId,
      oldValues: { review_id: reviewId, content: '消す返信です' },
    }));
  });

  test('権限を外された人は 403', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'REVIEW_REPLY_FORBIDDEN' } });
    const res = await remove();
    expect(res.status).toBe(403);
    expect(writeAuditLog).not.toHaveBeenCalled();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  test('表の権限が欠けた 42501（設定ミス）は通知つきの 500', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for table review_replies' } });
    const res = await remove();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: '返信を削除できませんでした' });
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  test('想定外の DB エラーは通知つきの 500', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '57014' } });
    const res = await remove();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: '返信を削除できませんでした' });
    expect(mockAlert).toHaveBeenCalledTimes(1);
  });

  test('既に消えている・他店の返信は 0 行＝404', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const res = await remove();
    expect(res.status).toBe(404);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  test.each([[null], [[deleted, deleted]], [[{ ...deleted, id: reviewId }]]])('結果が確認できない（%p）なら通知つきの 500', async (data) => {
    mockRpc.mockResolvedValue({ data, error: null });
    const res = await remove();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: '返信の削除を確認できませんでした。画面を再読み込みしてください' });
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  test.each([[null, replyId], [facilityId, 'bad-id']])('店舗 %s・返信 %s が不正なら 400', async (fid, id) => {
    expect((await remove(fid, id)).status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe.each([
  ['PATCH', () => patch()],
  ['DELETE', () => remove()],
])('%s の入口', (_method, call) => {
  test('未ログインは 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await call()).status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('認証基盤の障害は 503 で書き込まない', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: { status: 522 } });
    expect((await call()).status).toBe(503);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('レート制限は 429（公開・編集・削除で同じ枠）', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);
    expect((await call()).status).toBe(429);
    expect(checkRateLimit).toHaveBeenCalledWith(null, expect.any(String), 30, 60_000, 'admin-review-replies');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('CSRF の拒否はそのまま返し、書き込まない', async () => {
    const rejected = new Response('csrf', { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(rejected);
    expect(await call()).toBe(rejected);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('RPC の通信失敗は 500 で、成功の監査ログを残さない', async () => {
    mockRpc.mockRejectedValue(new Error('synthetic'));
    expect((await call()).status).toBe(500);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});
