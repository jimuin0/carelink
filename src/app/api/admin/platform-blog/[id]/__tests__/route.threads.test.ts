/**
 * @jest-environment node
 *
 * PATCH /api/admin/platform-blog/[id] — 記事の公開（is_published が最終的に true）を
 * Threads 投稿のきっかけに配線する分岐を検証する。
 *
 * 検証したい負の対照（実装から意図的に外して赤くなることを確認済み・戻して緑再確認済み）:
 *   (a) claim の `.is('threads_post_id', null)` を外す → 二重投稿を防げない
 *   (b) `runAfterResponse` を `void` 直呼びに戻す → このテストの「runAfterResponse 経由で
 *       登録されている」検査が赤くなる
 *   (c) 公開取り消し→再公開で再投稿しないガード（threads_post_id IS NULL）を壊す → 赤くなる
 *       （このテストでは「claim が threads_post_id IS NULL を条件にしている」ことを
 *       claim チェーンの呼び出し引数で直接検証する）
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/platform-admin', () => ({
  requirePlatformAdmin: jest.fn(() => Promise.resolve({ id: 'admin-1' })),
}));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertWarning: jest.fn() }));
jest.mock('@/lib/threads', () => ({
  publishThreadsText: jest.fn(),
  buildArticlePostText: jest.fn((title: string, url: string) => `${title} ${url}`),
}));
jest.mock('@/lib/after-response', () => {
  const actual = jest.requireActual('@/lib/after-response');
  return { runAfterResponse: jest.fn(actual.runAfterResponse) };
});

const mockAdminFrom = jest.fn();
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { PATCH } from '../route';
import { runAfterResponse } from '@/lib/after-response';
import { alertWarning } from '@/lib/alert';
import { publishThreadsText } from '@/lib/threads';

const POST_UUID = '11111111-1111-1111-1111-111111111111';

function makeProps(id = POST_UUID) {
  return { params: Promise.resolve({ id }) };
}

function makePatchRequest(body: object) {
  return new NextRequest(`http://localhost/api/admin/platform-blog/${POST_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// 本体 PATCH の update → .update().eq().select().maybeSingle()
function patchUpdateChain(data: unknown) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          maybeSingle: jest.fn(() => Promise.resolve({ data, error: null })),
        }),
      }),
    }),
  };
}

// claim → .update().eq().is().is().select('id')
function claimChain(claimedRows: unknown, error: unknown = null) {
  const chain: Record<string, jest.Mock> = {};
  chain.update = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.is = jest.fn(() => chain);
  chain.select = jest.fn(() => Promise.resolve({ data: claimedRows, error }));
  return chain;
}

// finalize / release → .update().eq().is()（.select を挟まず終端で await される）
function terminalUpdateChain() {
  const chain: Record<string, unknown> = {};
  chain.update = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.is = jest.fn(() => chain);
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
  return chain;
}

async function flushThreadsTask() {
  const calls = (runAfterResponse as jest.Mock).mock.results;
  await Promise.all(calls.map((r) => r.value));
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

test('is_published=false（更新結果） → runAfterResponse は呼ばれない', async () => {
  mockAdminFrom.mockReturnValueOnce(
    patchUpdateChain({ id: POST_UUID, slug: 's', title: 't', is_published: false })
  );
  const res = await PATCH(makePatchRequest({ is_published: false }), makeProps());
  expect(res.status).toBe(200);
  expect(runAfterResponse).not.toHaveBeenCalled();
  expect(publishThreadsText).not.toHaveBeenCalled();
});

test('is_published=true（更新結果） → runAfterResponse 経由で登録され、claim が CAS になっている', async () => {
  const claim = claimChain([{ id: POST_UUID }]);
  mockAdminFrom
    .mockReturnValueOnce(patchUpdateChain({ id: POST_UUID, slug: 's', title: 't', is_published: true }))
    .mockReturnValueOnce(claim)
    .mockReturnValueOnce(terminalUpdateChain());
  (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'published', postId: 'th-1' });

  const res = await PATCH(makePatchRequest({ is_published: true }), makeProps());
  expect(res.status).toBe(200);
  expect(runAfterResponse).toHaveBeenCalledTimes(1);
  await flushThreadsTask();
  expect(publishThreadsText).toHaveBeenCalledTimes(1);
  // claim が CAS になっている根拠：threads_post_id / threads_posted_at の両方を
  // IS NULL で絞り込んでいること（どちらかを外すと、公開取り消し→再公開で再投稿してしまう
  // ／同時 PATCH で二重投稿してしまう）。
  expect(claim.is).toHaveBeenCalledWith('threads_post_id', null);
  expect(claim.is).toHaveBeenCalledWith('threads_posted_at', null);
});

test('公開取り消し→再公開でも threads_post_id が既にあれば claim できず再投稿しない', async () => {
  mockAdminFrom
    .mockReturnValueOnce(patchUpdateChain({ id: POST_UUID, slug: 's', title: 't', is_published: true }))
    .mockReturnValueOnce(claimChain([])); // threads_post_id IS NOT NULL のため claim 0件
  const res = await PATCH(makePatchRequest({ is_published: true }), makeProps());
  expect(res.status).toBe(200);
  await flushThreadsTask();
  expect(publishThreadsText).not.toHaveBeenCalled();
  expect(mockAdminFrom).toHaveBeenCalledTimes(2); // 本体update + claim のみ（finalize/release無し）
});

test('claim update 自体がエラー → publishThreadsText を呼ばない', async () => {
  mockAdminFrom
    .mockReturnValueOnce(patchUpdateChain({ id: POST_UUID, slug: 's', title: 't', is_published: true }))
    .mockReturnValueOnce(claimChain(null, { message: 'db error' }));
  const res = await PATCH(makePatchRequest({ is_published: true }), makeProps());
  expect(res.status).toBe(200);
  await flushThreadsTask();
  expect(publishThreadsText).not.toHaveBeenCalled();
});

test('outcome=published → threads_post_id を書き込む（finalize）', async () => {
  mockAdminFrom
    .mockReturnValueOnce(patchUpdateChain({ id: POST_UUID, slug: 's', title: 't', is_published: true }))
    .mockReturnValueOnce(claimChain([{ id: POST_UUID }]));
  const finalize = terminalUpdateChain();
  mockAdminFrom.mockReturnValueOnce(finalize);
  (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'published', postId: 'th-999' });

  const res = await PATCH(makePatchRequest({ is_published: true }), makeProps());
  expect(res.status).toBe(200);
  await flushThreadsTask();
  expect(finalize.update).toHaveBeenCalledWith({ threads_post_id: 'th-999' });
});

test('outcome=published かつ postId 無し → threads_post_id に null（?? null 分岐）', async () => {
  mockAdminFrom
    .mockReturnValueOnce(patchUpdateChain({ id: POST_UUID, slug: 's', title: 't', is_published: true }))
    .mockReturnValueOnce(claimChain([{ id: POST_UUID }]));
  const finalize = terminalUpdateChain();
  mockAdminFrom.mockReturnValueOnce(finalize);
  (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'published' });

  const res = await PATCH(makePatchRequest({ is_published: true }), makeProps());
  expect(res.status).toBe(200);
  await flushThreadsTask();
  expect(finalize.update).toHaveBeenCalledWith({ threads_post_id: null });
});

test('outcome=skipped → claim を解放し、通知しない', async () => {
  mockAdminFrom
    .mockReturnValueOnce(patchUpdateChain({ id: POST_UUID, slug: 's', title: 't', is_published: true }))
    .mockReturnValueOnce(claimChain([{ id: POST_UUID }]));
  const release = terminalUpdateChain();
  mockAdminFrom.mockReturnValueOnce(release);
  (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'skipped' });

  const res = await PATCH(makePatchRequest({ is_published: true }), makeProps());
  expect(res.status).toBe(200);
  await flushThreadsTask();
  expect(release.update).toHaveBeenCalledWith({ threads_posted_at: null });
  expect(alertWarning).not.toHaveBeenCalled();
});

test('outcome=transient → claim を解放し、通知しない', async () => {
  mockAdminFrom
    .mockReturnValueOnce(patchUpdateChain({ id: POST_UUID, slug: 's', title: 't', is_published: true }))
    .mockReturnValueOnce(claimChain([{ id: POST_UUID }]));
  const release = terminalUpdateChain();
  mockAdminFrom.mockReturnValueOnce(release);
  (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'transient', reason: '503' });

  const res = await PATCH(makePatchRequest({ is_published: true }), makeProps());
  expect(res.status).toBe(200);
  await flushThreadsTask();
  expect(release.update).toHaveBeenCalledWith({ threads_posted_at: null });
  expect(alertWarning).not.toHaveBeenCalled();
});

test('outcome=permanent → claim を解放し、alertWarning で通知する', async () => {
  mockAdminFrom
    .mockReturnValueOnce(patchUpdateChain({ id: POST_UUID, slug: 's', title: 't', is_published: true }))
    .mockReturnValueOnce(claimChain([{ id: POST_UUID }]));
  const release = terminalUpdateChain();
  mockAdminFrom.mockReturnValueOnce(release);
  (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'permanent', reason: 'token expired' });

  const res = await PATCH(makePatchRequest({ is_published: true }), makeProps());
  expect(res.status).toBe(200);
  await flushThreadsTask();
  expect(release.update).toHaveBeenCalledWith({ threads_posted_at: null });
  expect(alertWarning).toHaveBeenCalledTimes(1);
  expect((alertWarning as jest.Mock).mock.calls[0][0]).toContain('token expired');
});

test('outcome=permanent かつ reason 無し → "unknown" で通知する（?? "unknown" 分岐）', async () => {
  mockAdminFrom
    .mockReturnValueOnce(patchUpdateChain({ id: POST_UUID, slug: 's', title: 't', is_published: true }))
    .mockReturnValueOnce(claimChain([{ id: POST_UUID }]));
  mockAdminFrom.mockReturnValueOnce(terminalUpdateChain());
  (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'permanent' });

  const res = await PATCH(makePatchRequest({ is_published: true }), makeProps());
  expect(res.status).toBe(200);
  await flushThreadsTask();
  expect((alertWarning as jest.Mock).mock.calls[0][0]).toContain('unknown');
});

test('publishThreadsText が Error 以外を throw → String(e) に倒し claim を解放する', async () => {
  mockAdminFrom
    .mockReturnValueOnce(patchUpdateChain({ id: POST_UUID, slug: 's', title: 't', is_published: true }))
    .mockReturnValueOnce(claimChain([{ id: POST_UUID }]));
  const release = terminalUpdateChain();
  mockAdminFrom.mockReturnValueOnce(release);
  (publishThreadsText as jest.Mock).mockRejectedValue('boom');

  const res = await PATCH(makePatchRequest({ is_published: true }), makeProps());
  expect(res.status).toBe(200);
  await flushThreadsTask();
  expect(release.update).toHaveBeenCalledWith({ threads_posted_at: null });
});

test('publishThreadsText が Error を throw → transient 相当として claim を解放する', async () => {
  mockAdminFrom
    .mockReturnValueOnce(patchUpdateChain({ id: POST_UUID, slug: 's', title: 't', is_published: true }))
    .mockReturnValueOnce(claimChain([{ id: POST_UUID }]));
  const release = terminalUpdateChain();
  mockAdminFrom.mockReturnValueOnce(release);
  (publishThreadsText as jest.Mock).mockRejectedValue(new Error('network down'));

  const res = await PATCH(makePatchRequest({ is_published: true }), makeProps());
  expect(res.status).toBe(200);
  await flushThreadsTask();
  expect(release.update).toHaveBeenCalledWith({ threads_posted_at: null });
});
