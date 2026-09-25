jest.mock('@/lib/supabase-server', () => ({}));
jest.mock('@/lib/alert', () => ({ alertWarning: jest.fn() }));
jest.mock('@/lib/threads', () => ({
  publishThreadsText: jest.fn(),
  buildArticlePostText: jest.fn(() => 'post body'),
}));

import { alertWarning } from '@/lib/alert';
import { publishThreadsText } from '@/lib/threads';
import { publishArticleToThreads } from '../platform-blog-threads';

type Config = {
  claim?: { data: { id: string }[] | null; error?: unknown };
  finalizeError?: unknown;
  ambiguousWriteError?: unknown;
  releaseError?: unknown;
};

function setup(config: Config = {}) {
  const updates: Record<string, unknown>[] = [];
  const client = { from: jest.fn((table: string) => {
    if (table !== 'platform_blog_posts') throw new Error(`unexpected table: ${table}`);
    return {
      update: jest.fn((patch: Record<string, unknown>) => {
        updates.push(patch);
        if (patch.threads_post_status === 'processing') {
          const chain: Record<string, jest.Mock> = {};
          chain.eq = jest.fn(() => chain);
          chain.is = jest.fn(() => chain);
          chain.select = jest.fn().mockResolvedValue(config.claim ?? { data: [{ id: 'post-1' }], error: null });
          return chain;
        }
        return {
          eq: jest.fn(() => ({
            is: jest.fn().mockResolvedValue({
              error: patch.threads_post_id
                ? config.finalizeError
                : patch.threads_post_status === 'ambiguous'
                  ? config.ambiguousWriteError
                  : config.releaseError,
            }),
          })),
        };
      }),
    };
  }) };
  return { client, updates };
}

beforeEach(() => jest.clearAllMocks());

test('claim競合では外部投稿を行わない', async () => {
  const { client } = setup({ claim: { data: [], error: null } });

  await publishArticleToThreads(client as never, { id: 'post-1', slug: 'slug', title: 'title' }, '/route');

  expect(publishThreadsText).not.toHaveBeenCalled();
});

test('投稿成功後にpostIdがない場合はambiguousとして警告する', async () => {
  const { client, updates } = setup();
  (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'published' });

  await publishArticleToThreads(client as never, { id: 'post-1', slug: 'slug', title: 'title' }, '/route');

  expect(updates).toContainEqual(expect.objectContaining({ threads_post_status: 'ambiguous' }));
  expect(alertWarning).toHaveBeenCalled();
});

test('投稿成功後のfinalize失敗はambiguousとして隔離する', async () => {
  const { client, updates } = setup({ finalizeError: { message: 'write failed' } });
  (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'published', postId: 'thread-post' });

  await publishArticleToThreads(client as never, { id: 'post-1', slug: 'slug', title: 'title' }, '/route');

  expect(updates).toContainEqual(expect.objectContaining({ threads_post_status: 'ambiguous' }));
  expect(alertWarning).toHaveBeenCalled();
});

test('Threads投稿が恒久失敗なら状態を記録し、claimを解放しない', async () => {
  const { client, updates } = setup();
  (publishThreadsText as jest.Mock).mockResolvedValue({ outcome: 'permanent', reason: 'token revoked' });

  await publishArticleToThreads(client as never, { id: 'post-1', slug: 'slug', title: 'title' }, '/route');

  expect(updates).toContainEqual(expect.objectContaining({ threads_post_status: 'permanent' }));
  expect(updates).not.toContainEqual(expect.objectContaining({ threads_posted_at: null }));
  expect(alertWarning).toHaveBeenCalled();
});

test('予期しないthrowはtransientとしてclaimを解放する', async () => {
  const { client, updates } = setup();
  (publishThreadsText as jest.Mock).mockRejectedValue(new Error('network failure'));

  await publishArticleToThreads(client as never, { id: 'post-1', slug: 'slug', title: 'title' }, '/route');

  expect(updates).toContainEqual(expect.objectContaining({ threads_posted_at: null }));
});
