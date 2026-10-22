/**
 * @jest-environment jsdom
 *
 * 「役に立った」の件数と押下状態（2026年10月23日）。
 * 以前は件数のために review_helpful をブラウザから直接読み（select('review_id').in(...)）、
 * そのために誰でも全員の押下を押した人のアカウント ID つきで読めた。アカウント ID は
 * プロフィール写真の公開パスでもある。件数は get_review_helpful_counts（口コミ ID と件数だけを返す）
 * から受け取り、review_helpful を読むのは「自分が押したか」を自分の user_id で絞るときだけにする
 * （20261023110200 でブラウザのロールから読めるのは本人の行だけになった）。
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import ReviewList from '../ReviewList';
import type { FacilityReview } from '@/types';

type TableRead = { table: string; select: string | null; eq: [string, unknown][] };
const tableReads: TableRead[] = [];
const rpcCalls: { name: string; args: unknown }[] = [];
let currentUser: { id: string } | null = null;
let countResult: { data: unknown; error: unknown } = { data: [], error: null };
let myVotes: { review_id: string }[] = [];

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/facility/test-salon',
}));
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: currentUser } }) },
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(countResult);
    },
    from: (table: string) => {
      const read: TableRead = { table, select: null, eq: [] };
      tableReads.push(read);
      const result = () => ({ data: table === 'review_helpful' ? myVotes : [], error: null });
      const chain: Record<string, unknown> = {
        select: (columns: string) => { read.select = columns; return chain; },
        eq: (column: string, value: unknown) => { read.eq.push([column, value]); return chain; },
        in: () => chain,
        order: () => Promise.resolve(result()),
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
      };
      return chain;
    },
  }),
}));

function review(id: string): FacilityReview {
  return {
    id, facility_id: 'fac-1', user_id: null, reviewer_name: 'たろー', rating: 4,
    rating_skill: null, rating_service: null, rating_atmosphere: null, rating_cleanliness: null, rating_explanation: null,
    comment: '良かったです', photo_urls: null, is_verified_visit: false, status: 'published', created_at: '2026-10-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  tableReads.length = 0;
  rpcCalls.length = 0;
  currentUser = null;
  myVotes = [];
  countResult = { data: [{ review_id: 'review-1', helpful_count: 3 }], error: null };
});

test('件数は関数から受け取り、ログインしていなければ review_helpful を一切読まない', async () => {
  render(<ReviewList reviews={[review('review-1'), review('review-2')]} />);
  expect(await screen.findByRole('button', { name: '役に立った (3)' })).toBeInTheDocument();
  // 押されていない口コミは件数を出さない
  expect(screen.getByRole('button', { name: '役に立った' })).toBeInTheDocument();
  expect(rpcCalls).toEqual([{ name: 'get_review_helpful_counts', args: { p_review_ids: ['review-1', 'review-2'] } }]);
  expect(tableReads.filter((r) => r.table === 'review_helpful')).toEqual([]);
});

test('ログイン中は自分の押下だけを自分の user_id で絞って読み、押下済みとして表示する', async () => {
  currentUser = { id: 'me-1' };
  myVotes = [{ review_id: 'review-1' }];
  render(<ReviewList reviews={[review('review-1')]} />);
  const button = await screen.findByRole('button', { name: '役に立った (3)' });
  await waitFor(() => expect(button).toHaveClass('font-bold'));
  const reads = tableReads.filter((r) => r.table === 'review_helpful');
  expect(reads).toEqual([{ table: 'review_helpful', select: 'review_id', eq: [['user_id', 'me-1']] }]);
});

test('件数の取得に失敗しても一覧は表示し、件数は出さない', async () => {
  countResult = { data: null, error: { code: 'PGRST202' } };
  render(<ReviewList reviews={[review('review-1')]} />);
  expect(await screen.findByText('良かったです')).toBeInTheDocument();
  await waitFor(() => expect(rpcCalls).toHaveLength(1));
  expect(screen.getByRole('button', { name: '役に立った' })).toBeInTheDocument();
});
