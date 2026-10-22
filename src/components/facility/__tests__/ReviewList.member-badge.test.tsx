/**
 * @jest-environment jsdom
 *
 * 口コミ一覧の「会員」バッジ（2026年10月22日 新設）。
 * 投稿者名は本人が入力したニックネームをそのまま公開する（神原さん決定）ため、
 * なりすまし対策としてアカウントからの投稿（public_reviews.is_member=true）にだけバッジを出す。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import ReviewList from '../ReviewList';
import type { FacilityReview } from '@/types';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/facility/test-salon',
}));
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    from: () => ({
      select: () => ({
        in: () => ({ order: () => Promise.resolve({ data: [] }), then: (r: (v: unknown) => unknown) => r({ data: [] }) }),
        eq: () => ({ in: () => Promise.resolve({ data: [] }) }),
      }),
    }),
  }),
}));

function review(over: Partial<FacilityReview>): FacilityReview {
  return {
    id: 'review-1', facility_id: 'fac-1', user_id: null, reviewer_name: 'たろー', rating: 4,
    rating_skill: null, rating_service: null, rating_atmosphere: null, rating_cleanliness: null, rating_explanation: null,
    comment: null, photo_urls: null, is_verified_visit: false, status: 'published', created_at: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

test('アカウントからの投稿（is_member=true）には「会員」バッジを出し、入力した名前をそのまま表示する', async () => {
  render(<ReviewList reviews={[review({ is_member: true })]} />);
  expect(await screen.findByText('たろー')).toBeInTheDocument();
  expect(screen.getByText('会員')).toHaveAttribute('title', 'CareLinkの会員アカウントから投稿された口コミです');
});

test.each([false, null, undefined])('is_member=%s（未ログインの投稿・migration 適用前）にはバッジを出さない', async (isMember) => {
  render(<ReviewList reviews={[review({ id: `r-${String(isMember)}`, is_member: isMember })]} />);
  expect(await screen.findByText('たろー')).toBeInTheDocument();
  expect(screen.queryByText('会員')).not.toBeInTheDocument();
});
