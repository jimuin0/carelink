/**
 * @jest-environment node
 *
 * POST /api/admin/platform-blog — 記事の公開を Threads 投稿のきっかけに配線する分岐を検証する。
 *
 * 検証したい負の対照（実装から意図的に外して赤くなることを確認済み・戻して緑再確認済み）:
 *   (a) claim の `.is('threads_post_id', null)` を外す → 二重投稿を防げない
 *   (b) `runAfterResponse` を `void` 直呼びに戻す → このテストの「runAfterResponse 経由で
 *       登録されている」検査が赤くなる
 *   (c) 公開取り消し→再公開で再投稿しないガード（threads_post_id IS NULL）を壊す → 赤くなる
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
// 実体（フォールバック経路含む）を維持しつつ、呼び出し自体を観測できるようにする
// （salons/route.post.test.ts と同じ形。runAfterResponse を直呼び void に戻すと
// このモックの呼び出し回数検査が壊れる）。
jest.mock('@/lib/after-response', () => {
  const actual = jest.requireActual('@/lib/after-response');
  return { runAfterResponse: jest.fn(actual.runAfterResponse) };
});

const mockAdminFrom = jest.fn();
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { runAfterResponse } from '@/lib/after-response';
import { alertWarning } from '@/lib/alert';
import { publishThreadsText } from '@/lib/threads';

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/admin/platform-blog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: object = {}) {
  return { slug: 'test-post', title: 'テスト投稿', ...overrides };
}

// insert → .insert().select().single()
function insertChain(data: unknown) {
  return {
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn(() => Promise.resolve({ data, error: null })),
      }),
    }),
  };
}

// claim → .update().eq().is().is().select('id')  ※ .select() が終端
function claimChain(claimedRows: unknown, error: unknown = null) {
  const chain: Record<string, jest.Mock> = {};
  chain.update = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.is = jest.fn(() => chain);
  chain.select = jest.fn(() => Promise.resolve({ data: claimedRows, error }));
  return chain;
}

// finalize / release → .update().eq().is()  ※ .is() が終端（.select を挟まない）。
// 呼び出し元がそのまま await するので、chain 自体を thenable にする。
function terminalUpdateChain() {
  const chain: Record<string, unknown> = {};
  chain.update = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.is = jest.fn(() => chain);
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
  return chain;
}

// runAfterResponse がフォールバック経路（request scope 外なので after() が throw）を通って
// 呼び出した task の完了を待つためのヘルパー。
async function flushThreadsTask() {
  const calls = (runAfterResponse as jest.Mock).mock.results;
  await Promise.all(calls.map((r) => r.value));
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

test('is_published=false → runAfterResponse は呼ばれない（Threads 配線なし）', async () => {
  mockAdminFrom.mockReturnValueOnce(insertChain({ id: 'p1', slug: 'test-post', title: 'テスト投稿', is_published: false }));
  const res = await POST(makeRequest(validBody({ is_published: false })));
  expect(res.status).toBe(201);
  expect(runAfterResponse).not.toHaveBeenCalled();
  expect(publishThreadsText).not.toHaveBeenCalled();
});

test('is_published=true → runAfterResponse 経由で登録されている（直呼びに戻すと落ちる）', async () => {
  const claim = claimChain([{ id: 'p1' }]);
  mockAdminFrom
    .mockReturnValueOnce(insertChain({ id: 'p1', slug: 'test-post', title: 'テスト投稿', is_published: true }))
    .mockReturnValueOnce(claim)
    .mockReturnValueOnce(terminalUpdateChain());
  (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'published', postId: 'th-1' });

  const res = await POST(makeRequest(validBody({ is_published: true })));
  expect(res.status).toBe(201);
  expect(runAfterResponse).toHaveBeenCalledTimes(1);
  await flushThreadsTask();
  expect(publishThreadsText).toHaveBeenCalledTimes(1);
  // claim が CAS になっている根拠：threads_post_id / threads_posted_at の両方を
  // IS NULL で絞り込んでいること（どちらかを外すと二重投稿・再投稿を防げない）。
  expect(claim.is).toHaveBeenCalledWith('threads_post_id', null);
  expect(claim.is).toHaveBeenCalledWith('threads_posted_at', null);
});

test('claim が取れない（同時実行/既投稿）→ publishThreadsText を呼ばない', async () => {
  mockAdminFrom
    .mockReturnValueOnce(insertChain({ id: 'p1', slug: 'test-post', title: 'テスト投稿', is_published: true }))
    .mockReturnValueOnce(claimChain([])); // 0件 = claim 失敗
  const res = await POST(makeRequest(validBody({ is_published: true })));
  expect(res.status).toBe(201);
  await flushThreadsTask();
  expect(publishThreadsText).not.toHaveBeenCalled();
  expect(mockAdminFrom).toHaveBeenCalledTimes(2); // insert + claim のみ（finalize/release は無し）
});

test('claim update 自体がエラー → publishThreadsText を呼ばない', async () => {
  mockAdminFrom
    .mockReturnValueOnce(insertChain({ id: 'p1', slug: 'test-post', title: 'テスト投稿', is_published: true }))
    .mockReturnValueOnce(claimChain(null, { message: 'db error' }));
  const res = await POST(makeRequest(validBody({ is_published: true })));
  expect(res.status).toBe(201);
  await flushThreadsTask();
  expect(publishThreadsText).not.toHaveBeenCalled();
});

test('outcome=published → threads_post_id を書き込む（finalize）', async () => {
  mockAdminFrom
    .mockReturnValueOnce(insertChain({ id: 'p1', slug: 'test-post', title: 'テスト投稿', is_published: true }))
    .mockReturnValueOnce(claimChain([{ id: 'p1' }]));
  const finalize = terminalUpdateChain();
  mockAdminFrom.mockReturnValueOnce(finalize);
  (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'published', postId: 'th-123' });

  const res = await POST(makeRequest(validBody({ is_published: true })));
  expect(res.status).toBe(201);
  await flushThreadsTask();
  expect(finalize.update).toHaveBeenCalledWith({ threads_post_id: 'th-123' });
  expect(alertWarning).not.toHaveBeenCalled();
});

test('outcome=skipped（Threads未設定）→ claim を解放し、通知しない', async () => {
  mockAdminFrom
    .mockReturnValueOnce(insertChain({ id: 'p1', slug: 'test-post', title: 'テスト投稿', is_published: true }))
    .mockReturnValueOnce(claimChain([{ id: 'p1' }]));
  const release = terminalUpdateChain();
  mockAdminFrom.mockReturnValueOnce(release);
  (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'skipped' });

  const res = await POST(makeRequest(validBody({ is_published: true })));
  expect(res.status).toBe(201);
  await flushThreadsTask();
  expect(release.update).toHaveBeenCalledWith({ threads_posted_at: null });
  expect(alertWarning).not.toHaveBeenCalled();
});

test('outcome=transient（一時失敗）→ claim を解放し、通知しない（backfill cron に任せる）', async () => {
  mockAdminFrom
    .mockReturnValueOnce(insertChain({ id: 'p1', slug: 'test-post', title: 'テスト投稿', is_published: true }))
    .mockReturnValueOnce(claimChain([{ id: 'p1' }]));
  const release = terminalUpdateChain();
  mockAdminFrom.mockReturnValueOnce(release);
  (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'transient', reason: '503' });

  const res = await POST(makeRequest(validBody({ is_published: true })));
  expect(res.status).toBe(201);
  await flushThreadsTask();
  expect(release.update).toHaveBeenCalledWith({ threads_posted_at: null });
  expect(alertWarning).not.toHaveBeenCalled();
});

test('outcome=permanent（恒久失敗）→ claim を解放し、alertWarning で通知する', async () => {
  mockAdminFrom
    .mockReturnValueOnce(insertChain({ id: 'p1', slug: 'test-post', title: 'テスト投稿', is_published: true }))
    .mockReturnValueOnce(claimChain([{ id: 'p1' }]));
  const release = terminalUpdateChain();
  mockAdminFrom.mockReturnValueOnce(release);
  (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'permanent', reason: 'token expired' });

  const res = await POST(makeRequest(validBody({ is_published: true })));
  expect(res.status).toBe(201);
  await flushThreadsTask();
  expect(release.update).toHaveBeenCalledWith({ threads_posted_at: null });
  expect(alertWarning).toHaveBeenCalledTimes(1);
  expect((alertWarning as jest.Mock).mock.calls[0][0]).toContain('token expired');
});

test('outcome=published かつ postId 無し → threads_post_id に null を書く（?? null 分岐）', async () => {
  mockAdminFrom
    .mockReturnValueOnce(insertChain({ id: 'p1', slug: 'test-post', title: 'テスト投稿', is_published: true }))
    .mockReturnValueOnce(claimChain([{ id: 'p1' }]));
  const finalize = terminalUpdateChain();
  mockAdminFrom.mockReturnValueOnce(finalize);
  (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'published' });

  const res = await POST(makeRequest(validBody({ is_published: true })));
  expect(res.status).toBe(201);
  await flushThreadsTask();
  expect(finalize.update).toHaveBeenCalledWith({ threads_post_id: null });
});

test('outcome=permanent かつ reason 無し → "unknown" で通知する（?? "unknown" 分岐）', async () => {
  mockAdminFrom
    .mockReturnValueOnce(insertChain({ id: 'p1', slug: 'test-post', title: 'テスト投稿', is_published: true }))
    .mockReturnValueOnce(claimChain([{ id: 'p1' }]));
  mockAdminFrom.mockReturnValueOnce(terminalUpdateChain());
  (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'permanent' });

  const res = await POST(makeRequest(validBody({ is_published: true })));
  expect(res.status).toBe(201);
  await flushThreadsTask();
  expect((alertWarning as jest.Mock).mock.calls[0][0]).toContain('unknown');
});

test('publishThreadsText が Error 以外の値を throw → String(e) に倒す', async () => {
  mockAdminFrom
    .mockReturnValueOnce(insertChain({ id: 'p1', slug: 'test-post', title: 'テスト投稿', is_published: true }))
    .mockReturnValueOnce(claimChain([{ id: 'p1' }]));
  mockAdminFrom.mockReturnValueOnce(terminalUpdateChain());
  (publishThreadsText as jest.Mock).mockRejectedValue('boom');

  const res = await POST(makeRequest(validBody({ is_published: true })));
  expect(res.status).toBe(201);
  await flushThreadsTask();
  expect(publishThreadsText).toHaveBeenCalledTimes(1);
});

test('publishThreadsText が想定外に throw → transient 相当として claim を解放する', async () => {
  mockAdminFrom
    .mockReturnValueOnce(insertChain({ id: 'p1', slug: 'test-post', title: 'テスト投稿', is_published: true }))
    .mockReturnValueOnce(claimChain([{ id: 'p1' }]));
  const release = terminalUpdateChain();
  mockAdminFrom.mockReturnValueOnce(release);
  (publishThreadsText as jest.Mock).mockRejectedValue(new Error('network down'));

  const res = await POST(makeRequest(validBody({ is_published: true })));
  expect(res.status).toBe(201);
  await flushThreadsTask();
  expect(release.update).toHaveBeenCalledWith({ threads_posted_at: null });
  expect(alertWarning).not.toHaveBeenCalled();
});
