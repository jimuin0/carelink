/**
 * @jest-environment node
 *
 * 店舗の口コミ管理一覧 API（2026年10月23日 新設）。
 * 以前の画面はブラウザから facility_reviews を select('*') で読み、投稿者の IP アドレスとアカウント ID が
 * 店舗のブラウザに届いていた。また status だけで『公開中』を出しており、運営の審査で止められた口コミも
 * 『公開中』に見えていた。
 */
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockServiceFrom = jest.fn();
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: mockFrom, auth: { getUser: mockGetUser } }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockServiceFrom }) }));
import { NextRequest } from 'next/server';
import { GET } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

const userId = '76000000-0000-4000-8000-000000000001';
const own = '76000000-0000-4000-8000-000000000002';
const other = '76000000-0000-4000-8000-000000000003';
const R1 = '76000000-0000-4000-8000-000000000011';
const R2 = '76000000-0000-4000-8000-000000000012';
const R3 = '76000000-0000-4000-8000-000000000013';
const R4 = '76000000-0000-4000-8000-000000000014';
let memberships: { data: unknown; error: unknown };
let reviews: { data: unknown; error: unknown };
let queue: { data: unknown; error: unknown };
const reviewCalls: unknown[][] = [];

function request(query: string) {
  return new NextRequest(`http://localhost/api/admin/reviews?${query}`, { headers: { host: 'localhost' } });
}

beforeEach(() => {
  jest.clearAllMocks();
  reviewCalls.length = 0;
  jest.mocked(checkRateLimit).mockResolvedValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  memberships = { data: [{ facility_id: own }], error: null };
  reviews = {
    data: [
      { id: R1, reviewer_name: '公開中のお客様', rating: 5, comment: 'よかった', status: 'published', is_flagged: false, created_at: '2026-10-04T00:00:00Z' },
      { id: R2, reviewer_name: '確認中のお客様', rating: 4, comment: '日本一です', status: 'published', is_flagged: true, created_at: '2026-10-03T00:00:00Z' },
      { id: R3, reviewer_name: '却下のお客様', rating: 1, comment: null, status: 'hidden', is_flagged: true, created_at: '2026-10-02T00:00:00Z' },
      { id: R4, reviewer_name: '状態不明のお客様', rating: 3, comment: null, status: null, is_flagged: false, created_at: null },
    ],
    error: null,
  };
  queue = {
    data: [
      { content_id: R2, status: 'pending', created_at: '2026-10-03T00:00:00Z' },
      { content_id: R3, status: 'rejected', created_at: '2026-10-02T01:00:00Z' },
    ],
    error: null,
  };
  mockFrom.mockImplementation((table: string) => {
    if (table === 'facility_members') {
      const chain = { select: () => chain, eq: () => chain, in: () => Promise.resolve(memberships) };
      return chain;
    }
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    for (const name of ['select', 'eq', 'or', 'order']) chain[name] = (...args: unknown[]) => { reviewCalls.push([table, name, ...args]); return chain; };
    chain.limit = (...args: unknown[]) => { reviewCalls.push([table, 'limit', ...args]); return Promise.resolve(reviews); };
    return chain;
  });
  mockServiceFrom.mockImplementation(() => {
    const chain = { select: () => chain, eq: () => chain, in: () => Promise.resolve(queue) };
    return chain;
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
});

test('未ログインは 401（口コミを読まない）', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await GET(request(`facility_id=${own}`))).status).toBe(401);
  expect(mockFrom).not.toHaveBeenCalled();
});

test('不正な絞り込みは 400（所属も口コミも読まない）', async () => {
  const response = await GET(request(`facility_id=${own}&filter=everything`));
  expect(response.status).toBe(400);
  expect(mockFrom).not.toHaveBeenCalled();
});

test.each([
  ['他店の facility_id', `facility_id=${other}`, 403, [{ facility_id: own }]],
  ['owner/admin の店舗が無い', `facility_id=${own}`, 403, []],
  ['複数店舗で店舗未指定', '', 400, [{ facility_id: own }, { facility_id: other }]],
])('%s → %i（口コミを読まない）', async (_label, query, status, rows) => {
  memberships = { data: rows, error: null };
  const response = await GET(request(query));
  expect(response.status).toBe(status);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(reviewCalls).toHaveLength(0);
});

test('所属の確認に失敗したら 500（空の一覧にしない）', async () => {
  memberships = { data: null, error: { message: 'synthetic' } };
  expect((await GET(request(`facility_id=${own}`))).status).toBe(500);
  expect(reviewCalls).toHaveLength(0);
});

test('画面に出す列だけを読み、投稿者の IP・アカウント ID・予約 ID を返さない', async () => {
  const response = await GET(request(`facility_id=${own}`));
  expect(response.status).toBe(200);
  const select = reviewCalls.find((c) => c[1] === 'select')!;
  expect(select[2]).toBe('id, reviewer_name, rating, comment, status, is_flagged, created_at');
  expect(String(select[2])).not.toMatch(/\*|reviewer_ip|user_id|booking_id|client_operation_id/);
  expect(reviewCalls).toContainEqual(['facility_reviews', 'eq', 'facility_id', own]);
  expect(reviewCalls).toContainEqual(['facility_reviews', 'limit', 100]);
  const body = await response.json();
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/reviewer_ip|user_id|booking_id|is_flagged/);
});

test('運営の審査状態を添える（公開中・運営の確認中・運営判断で非公開）', async () => {
  const body = await (await GET(request(`facility_id=${own}`))).json();
  expect(body.reviews.map((r: { id: string; status: string; moderation: string }) => [r.id, r.status, r.moderation])).toEqual([
    [R1, 'published', 'none'],
    [R2, 'published', 'pending'],
    [R3, 'hidden', 'rejected'],
    // status が NULL の行は公開ビューに出ないので「非表示」として見せる
    [R4, 'hidden', 'none'],
  ]);
});

test.each([
  ['published', [['eq', 'status', 'published'], ['eq', 'is_flagged', false]]],
  ['hidden', [['eq', 'status', 'hidden'], ['eq', 'is_flagged', false]]],
  ['moderation', [['or', 'is_flagged.is.null,is_flagged.eq.true']]],
  ['all', []],
])('絞り込み %s は公開ページと同じ条件で絞る', async (filter, expected) => {
  expect((await GET(request(`facility_id=${own}&filter=${filter}`))).status).toBe(200);
  const filters = reviewCalls.filter((c) => (c[1] === 'eq' && c[2] !== 'facility_id') || c[1] === 'or').map((c) => c.slice(1));
  expect(filters).toEqual(expected);
});

test('口コミを読めなければ 500', async () => {
  reviews = { data: null, error: { message: 'synthetic' } };
  const response = await GET(request(`facility_id=${own}`));
  expect(response.status).toBe(500);
  expect((await response.json()).error).toBe('口コミを読み込めませんでした');
});

test('応答の形が違えば 500', async () => {
  reviews = { data: null, error: null };
  expect((await GET(request(`facility_id=${own}`))).status).toBe(500);
});

test('審査状態を読めなければ 500（『公開中』と推測しない）', async () => {
  queue = { data: null, error: { message: 'synthetic' } };
  const response = await GET(request(`facility_id=${own}`));
  expect(response.status).toBe(500);
  expect((await response.json()).error).toBe('口コミの審査状態を確認できませんでした');
});
