/**
 * @jest-environment jsdom
 *
 * 口コミ 0 件の案内（神原さん判断 2026年10月23日）。
 * 以前は ReviewTab の「まだ口コミがありません」と ReviewList の「まだ口コミはありません。最初の口コミを
 * 投稿してみませんか？」が上下に 2 つ並んでいた。案内は 1 つにまとめ、投稿欄へ移るボタンを置く。
 * ReviewList は本物を描画する（空のときに何も出さないことまで確かめるため）。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import ReviewTab from '../ReviewTab';
import type { FacilityReview } from '@/types';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/facility/test-salon',
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    rpc: () => Promise.resolve({ data: [], error: null }),
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: [] }),
        eq: () => ({ in: () => Promise.resolve({ data: [] }) }),
      }),
    }),
  }),
}));
// 投稿欄は中身を問わない（投稿できるかどうかの判定は ReviewForm 側のテストが受け持つ）。
jest.mock('../ReviewForm', () => ({ __esModule: true, default: () => <div data-testid="review-form-stub" /> }));

const REVIEW: FacilityReview = {
  id: 'review-1',
  facility_id: 'fac-1',
  user_id: null,
  reviewer_name: 'テスト太郎',
  rating: 4,
  rating_skill: null,
  rating_service: null,
  rating_atmosphere: null,
  rating_cleanliness: null,
  rating_explanation: null,
  comment: 'とても良かったです',
  photo_urls: null,
  is_verified_visit: false,
  status: 'published',
  created_at: '2026-07-01T00:00:00.000Z',
};

beforeEach(() => {
  global.fetch = jest.fn() as unknown as typeof fetch;
});

test('0 件: 案内は 1 つだけで、「最初の口コミを書く」が投稿欄（#review-form）へ案内する', () => {
  const { container } = render(<ReviewTab facilityId="fac-1" initialReviews={[]} />);
  expect(screen.getAllByTestId('review-empty-state')).toHaveLength(1);
  expect(container.textContent?.match(/まだ口コミ/g)).toHaveLength(1);
  expect(screen.queryByText(/最初の口コミを投稿してみませんか/)).not.toBeInTheDocument();
  const cta = screen.getByRole('link', { name: '最初の口コミを書く' });
  expect(cta).toHaveAttribute('href', '#review-form');
  // 移った先に投稿欄が実在する（判定は投稿欄側に任せ、ここで迂回路を作らない）
  const form = container.querySelector('#review-form');
  expect(form).not.toBeNull();
  expect(form).toContainElement(screen.getByTestId('review-form-stub'));
});

test('1 件以上: 空の案内もボタンも出さず、口コミを並べる', () => {
  const { container } = render(<ReviewTab facilityId="fac-1" initialReviews={[REVIEW]} />);
  expect(screen.queryByTestId('review-empty-state')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '最初の口コミを書く' })).not.toBeInTheDocument();
  expect(container.textContent).not.toMatch(/まだ口コミ/);
  expect(screen.getByText('とても良かったです')).toBeInTheDocument();
});
