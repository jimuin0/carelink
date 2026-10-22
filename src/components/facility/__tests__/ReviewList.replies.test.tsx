/**
 * @jest-environment jsdom
 *
 * 店舗ページの「サロンより」返信（2026年10月22日）。
 * 店舗は投稿した返信を後から編集・削除できる。店舗ページ（ISR）の HTML には返信を焼き込まず、
 * 表示のたびにブラウザから review_replies を読むので、編集すれば次の表示から新しい本文になり、
 * 削除すれば何も出ない（ページのキャッシュが切れるのを待たない）。
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import ReviewList from '../ReviewList';
import type { FacilityReview } from '@/types';

let replyRows: { id: string; review_id: string; content: string; created_at: string | null }[] = [];
const replyQueries: string[][] = [];

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/facility/test-salon',
}));
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    from: (table: string) => ({
      select: () => ({
        in: (_column: string, ids: string[]) => {
          if (table === 'review_replies') replyQueries.push(ids);
          return {
            order: () => Promise.resolve({ data: table === 'review_replies' ? replyRows : [] }),
            then: (r: (v: unknown) => unknown) => r({ data: [] }),
          };
        },
        eq: () => ({ in: () => Promise.resolve({ data: [] }) }),
      }),
    }),
  }),
}));

const review: FacilityReview = {
  id: 'review-1', facility_id: 'fac-1', user_id: null, reviewer_name: 'たろー', rating: 4,
  rating_skill: null, rating_service: null, rating_atmosphere: null, rating_cleanliness: null, rating_explanation: null,
  comment: '良かったです', photo_urls: null, is_verified_visit: false, status: 'published', created_at: '2026-10-01T00:00:00.000Z',
};

beforeEach(() => { replyQueries.length = 0; });

test('返信は表示のたびに読み、今の本文（編集後の本文）を改行を保って出す', async () => {
  replyRows = [{ id: 'reply-1', review_id: 'review-1', content: '修正した返信です\nまたのお越しを', created_at: '2026-10-22T00:00:00.000Z' }];
  render(<ReviewList reviews={[review]} />);
  const text = await screen.findByText(/修正した返信です/);
  expect(text).toHaveClass('whitespace-pre-wrap');
  expect(text.textContent).toBe('修正した返信です\nまたのお越しを');
  expect(screen.getByText('サロンより')).toBeInTheDocument();
  expect(replyQueries).toEqual([['review-1']]);
});

test('削除された返信（行が無い）は何も出さない', async () => {
  replyRows = [];
  render(<ReviewList reviews={[review]} />);
  expect(await screen.findByText('たろー')).toBeInTheDocument();
  await waitFor(() => expect(replyQueries).toEqual([['review-1']]));
  expect(screen.queryByText('サロンより')).not.toBeInTheDocument();
});
