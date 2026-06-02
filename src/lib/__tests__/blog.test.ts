/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for lib/blog.ts
 * Covers getBlogsByFacility and getBlogPost
 */

const mockFrom = jest.fn();

jest.mock('../supabase-server', () => ({
  createServerSupabaseClient: jest.fn(() => ({ from: mockFrom })),
}));

import { getBlogsByFacility, getBlogPost } from '../blog';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getBlogsByFacility()', () => {
  test('データあり → 投稿一覧を返す', async () => {
    const posts = [
      { id: 'p1', facility_id: 'f1', title: 'Post 1', slug: 'post-1', is_published: true, published_at: '2026-04-01' },
    ];
    const orderFn = jest.fn(() => Promise.resolve({ data: posts }));
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      order: orderFn,
    };
    mockFrom.mockReturnValue(chain);

    const result = await getBlogsByFacility('f1');
    expect(result).toEqual(posts);
    expect(orderFn).toHaveBeenCalledWith('published_at', { ascending: false });
  });

  test('data が null → 空配列を返す', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      order: jest.fn(() => Promise.resolve({ data: null })),
    };
    mockFrom.mockReturnValue(chain);

    const result = await getBlogsByFacility('f1');
    expect(result).toEqual([]);
  });

  test('投稿なし → 空配列を返す', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      order: jest.fn(() => Promise.resolve({ data: [] })),
    };
    mockFrom.mockReturnValue(chain);

    const result = await getBlogsByFacility('f1');
    expect(result).toEqual([]);
  });

  test('scheduled_at 列未適用(PGRST204) → .or無しで再取得しJS側で予約判定(#5)', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const past = new Date(Date.now() - 86400000).toISOString();
    const posts = [
      { id: 'p1', facility_id: 'f1', is_published: true, scheduled_at: past },     // 公開済み
      { id: 'p2', facility_id: 'f1', is_published: true, scheduled_at: future },   // 未来予約 → 除外
      { id: 'p3', facility_id: 'f1', is_published: true, scheduled_at: null },     // 即時公開
    ];
    const errChain = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), or: jest.fn().mockReturnThis(), order: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST204', message: 'column blog_posts.scheduled_at does not exist' } })) };
    const okChain = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), order: jest.fn(() => Promise.resolve({ data: posts, error: null })) };
    mockFrom.mockReturnValueOnce(errChain).mockReturnValueOnce(okChain);
    const result = await getBlogsByFacility('f1');
    expect(result.map((p: { id: string }) => p.id)).toEqual(['p1', 'p3']); // 未来予約 p2 のみ除外
  });

  test('scheduled_at 未適用 + 再取得も data null → 空配列(#5 retry.data ?? [])', async () => {
    const errChain = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), or: jest.fn().mockReturnThis(), order: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST204', message: 'col missing' } })) };
    const nullChain = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), order: jest.fn(() => Promise.resolve({ data: null, error: null })) };
    mockFrom.mockReturnValueOnce(errChain).mockReturnValueOnce(nullChain);
    expect(await getBlogsByFacility('f1')).toEqual([]);
  });
});

describe('getBlogPost()', () => {
  test('スラッグで投稿を返す', async () => {
    const post = { id: 'p1', facility_id: 'f1', slug: 'my-post', is_published: true };
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      single: jest.fn(() => Promise.resolve({ data: post })),
    };
    mockFrom.mockReturnValue(chain);

    const result = await getBlogPost('f1', 'my-post');
    expect(result).toEqual(post);
  });

  test('投稿が見つからない → null を返す', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      single: jest.fn(() => Promise.resolve({ data: null })),
    };
    mockFrom.mockReturnValue(chain);

    const result = await getBlogPost('f1', 'nonexistent');
    expect(result).toBeNull();
  });

  test('scheduled_at 列未適用 → 再取得・公開済みは返す(#5)', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const post = { id: 'p1', facility_id: 'f1', slug: 'my-post', is_published: true, scheduled_at: past };
    const errChain = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), or: jest.fn().mockReturnThis(), single: jest.fn(() => Promise.resolve({ data: null, error: { code: '42703', message: 'column does not exist' } })) };
    const okChain = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn(() => Promise.resolve({ data: post, error: null })) };
    mockFrom.mockReturnValueOnce(errChain).mockReturnValueOnce(okChain);
    expect(await getBlogPost('f1', 'my-post')).toEqual(post);
  });

  test('scheduled_at 列未適用 + 未来予約 → 再取得後にJS判定でnull(#5)', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const post = { id: 'p1', facility_id: 'f1', slug: 'my-post', is_published: true, scheduled_at: future };
    const errChain = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), or: jest.fn().mockReturnThis(), single: jest.fn(() => Promise.resolve({ data: null, error: { code: '42703', message: 'column does not exist' } })) };
    const okChain = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn(() => Promise.resolve({ data: post, error: null })) };
    mockFrom.mockReturnValueOnce(errChain).mockReturnValueOnce(okChain);
    expect(await getBlogPost('f1', 'my-post')).toBeNull();
  });
});
