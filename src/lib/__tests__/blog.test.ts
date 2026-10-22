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

import { getBlogsByFacility, getBlogPost, getBlogSummariesByFacility, normalizeBlogTags } from '../blog';

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
      order: jest.fn(() => Promise.resolve({ data: [] })),
    };
    mockFrom.mockReturnValue(chain);

    const result = await getBlogsByFacility('f1');
    expect(result).toEqual([]);
  });
});

describe('getBlogPost()', () => {
  test('スラッグで投稿を返す', async () => {
    const post = { id: 'p1', facility_id: 'f1', slug: 'my-post', is_published: true };
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(() => Promise.resolve({ data: post })),
    };
    mockFrom.mockReturnValue(chain);

    const result = await getBlogPost('f1', 'my-post');
    expect(result).toEqual(post);
  });

  test('投稿が見つからない → null を返す', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(() => Promise.resolve({ data: null })),
    };
    mockFrom.mockReturnValue(chain);

    const result = await getBlogPost('f1', 'nonexistent');
    expect(result).toBeNull();
  });
});


test.each([null,undefined,{},'tag',1])('non-array tags %j are empty', value=>{expect(normalizeBlogTags(value)).toEqual([]);});
test('unknown tag elements cannot reach JSX/JSON-LD, valid strings remain',()=>{expect(normalizeBlogTags(['valid',null,{},0,'second'])).toEqual(['valid','second']);});
test.each(['list','post'])('DB %s failure/data plus error is not empty or not-found', async kind=>{
 const chain={select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),order:jest.fn().mockResolvedValue({data:[{id:'partial'}],error:{message:'private detail'}}),maybeSingle:jest.fn().mockResolvedValue({data:{id:'partial'},error:{message:'private detail'}})};
 mockFrom.mockReturnValue(chain);
 await expect(kind==='list'?getBlogsByFacility('f1'):getBlogPost('f1','post')).rejects.toThrow('unavailable');
});

/**
 * 施設ページの「ブログ」導線用（2026年10月22日 新設）。本文は読まず、新着の先頭数件と総数だけ返す。
 */
describe('getBlogSummariesByFacility()', () => {
  function summaryChain(result: { data: unknown; error: unknown; count: number | null }) {
    const c = {
      select: jest.fn(() => c),
      eq: jest.fn(() => c),
      order: jest.fn(() => c),
      limit: jest.fn(() => Promise.resolve(result)),
    };
    return c;
  }

  test('公開記事だけを新しい順に limit 件、総数つきで返す（本文は読まない）', async () => {
    const posts = [{ id: 'p2', slug: 'b', title: 'B', published_at: '2026-10-02' }, { id: 'p1', slug: 'a', title: 'A', published_at: '2026-10-01' }];
    const c = summaryChain({ data: posts, error: null, count: 7 });
    mockFrom.mockReturnValue(c);
    await expect(getBlogSummariesByFacility('f1', 2)).resolves.toEqual({ posts, total: 7 });
    expect(mockFrom).toHaveBeenCalledWith('blog_posts');
    expect(c.select).toHaveBeenCalledWith('id, slug, title, published_at', { count: 'exact' });
    expect(c.eq).toHaveBeenCalledWith('facility_id', 'f1');
    expect(c.eq).toHaveBeenCalledWith('is_published', true);
    expect(c.order).toHaveBeenCalledWith('published_at', { ascending: false, nullsFirst: false });
    expect(c.order).toHaveBeenCalledWith('id', { ascending: true });
    expect(c.limit).toHaveBeenCalledWith(2);
  });

  test('総数が取れなかったときは、取れた件数を下回らない', async () => {
    const posts = [{ id: 'p1', slug: 'a', title: 'A', published_at: null }];
    mockFrom.mockReturnValue(summaryChain({ data: posts, error: null, count: null }));
    await expect(getBlogSummariesByFacility('f1', 5)).resolves.toEqual({ posts, total: 1 });
  });

  test('記事なし → 0件', async () => {
    mockFrom.mockReturnValue(summaryChain({ data: [], error: null, count: 0 }));
    await expect(getBlogSummariesByFacility('f1', 5)).resolves.toEqual({ posts: [], total: 0 });
  });

  test.each([
    ['error が返る', { data: [{ id: 'partial' }], error: { message: 'private detail' }, count: 1 }],
    ['data が配列でない', { data: null, error: null, count: null }],
  ])('%s → 「記事なし」と取り違えず例外にする', async (_label, result) => {
    mockFrom.mockReturnValue(summaryChain(result));
    await expect(getBlogSummariesByFacility('f1', 5)).rejects.toThrow('Blog list unavailable');
  });
});
