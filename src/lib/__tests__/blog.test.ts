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

import { getBlogsByFacility, getBlogPost, normalizeBlogTags } from '../blog';

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
