/**
 * @jest-environment node
 *
 * 投稿者本人の口コミ API（2026年10月23日 新設）。店舗に投稿者のアカウント ID を見せないため、
 * facility_reviews.user_id の閲覧権限をブラウザのロールから外した。マイページはここから読む。
 */
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
const mockGetUser = jest.fn();
const mockServiceFrom = jest.fn();
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: jest.fn(), auth: { getUser: mockGetUser } }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockServiceFrom }) }));
import { NextRequest } from 'next/server';
import { GET } from '../route';

const userId = '77000000-0000-4000-8000-000000000001';
const R1 = '77000000-0000-4000-8000-000000000011';
const R2 = '77000000-0000-4000-8000-000000000012';
let reviews: { data: unknown; error: unknown };
let queue: { data: unknown; error: unknown };
const calls: unknown[][] = [];

function request(query = '') {
  return new NextRequest(`http://localhost/api/review/mine${query}`, { headers: { host: 'localhost' } });
}

beforeEach(() => {
  jest.clearAllMocks();
  calls.length = 0;
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  reviews = {
    data: [
      {
        id: R1, rating: 4, rating_skill: 4, rating_service: 4, rating_atmosphere: 4, rating_cleanliness: 4, rating_explanation: 4,
        comment: '日本一です', status: 'published', is_flagged: true, created_at: '2026-10-02T00:00:00Z',
        facility_profiles: { name: '合成サロン', slug: 'synthetic-salon' },
      },
      {
        id: R2, rating: 3, rating_skill: null, rating_service: null, rating_atmosphere: null, rating_cleanliness: null, rating_explanation: null,
        comment: null, status: 'hidden', is_flagged: false, created_at: null, facility_profiles: null,
      },
    ],
    error: null,
  };
  queue = { data: [{ content_id: R1, status: 'pending', created_at: '2026-10-02T00:00:00Z' }], error: null };
  mockServiceFrom.mockImplementation((table: string) => {
    if (table === 'moderation_queue') {
      const chain = { select: () => chain, eq: () => chain, in: () => Promise.resolve(queue) };
      return chain;
    }
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    for (const name of ['select', 'eq', 'order']) chain[name] = (...args: unknown[]) => { calls.push([name, ...args]); return chain; };
    chain.limit = (...args: unknown[]) => { calls.push(['limit', ...args]); return Promise.resolve(reviews); };
    return chain;
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
});

test('未ログインは 401（口コミを読まない）', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await GET(request())).status).toBe(401);
  expect(mockServiceFrom).not.toHaveBeenCalled();
});

test('本人の行だけを、内部の列（IP・アカウント ID）を含めずに読む', async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(calls).toContainEqual(['eq', 'user_id', userId]);
  const select = String(calls.find((c) => c[0] === 'select')![1]);
  expect(select).not.toMatch(/\*|reviewer_ip|user_id|booking_id|client_operation_id/);
  const body = await response.json();
  expect(JSON.stringify(body)).not.toMatch(/reviewer_ip|user_id|is_flagged/);
  expect(body.reviews).toEqual([
    expect.objectContaining({ id: R1, facility_name: '合成サロン', facility_slug: 'synthetic-salon', status: 'published', moderation: 'pending', rating_skill: 4 }),
    expect.objectContaining({ id: R2, facility_name: '不明な施設', facility_slug: '', status: 'hidden', moderation: 'none', created_at: null }),
  ]);
});

test('?id= で 1 件に絞る（編集画面用）', async () => {
  reviews = { data: [(reviews.data as unknown[])[1]], error: null };
  const response = await GET(request(`?id=${R2}`));
  expect(response.status).toBe(200);
  expect(calls).toContainEqual(['eq', 'id', R2]);
  expect(calls).toContainEqual(['eq', 'user_id', userId]);
  expect((await response.json()).reviews).toHaveLength(1);
});

test('他人の口コミ・存在しない id は 404', async () => {
  reviews = { data: [], error: null };
  const response = await GET(request(`?id=${R1}`));
  expect(response.status).toBe(404);
});

test('不正な id は 400（読まない）', async () => {
  expect((await GET(request('?id=not-a-uuid'))).status).toBe(400);
  expect(mockServiceFrom).not.toHaveBeenCalled();
});

test('一覧の id 指定なしで 0 件なら空の一覧', async () => {
  reviews = { data: [], error: null };
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect((await response.json()).reviews).toEqual([]);
});

test.each([
  ['読み取りの失敗', { data: null, error: { message: 'synthetic' } }],
  ['応答の形の違い', { data: null, error: null }],
])('%s は 500', async (_label, result) => {
  reviews = result;
  expect((await GET(request())).status).toBe(500);
});

test('公開状況（審査）を読めなければ 500', async () => {
  queue = { data: null, error: { message: 'synthetic' } };
  const response = await GET(request());
  expect(response.status).toBe(500);
  expect((await response.json()).error).toBe('口コミの公開状況を確認できませんでした');
});
