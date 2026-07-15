/**
 * @jest-environment jsdom
 *
 * 【2026年7月15日 通報 要ログイン化】/api/report が 401 を返すようになったことに伴う
 * UI 回帰テスト。未ログイン時は通報確認ダイアログでなく「ログインが必要です」の
 * 案内ダイアログを表示し、/auth/login?redirect=現在ページ への導線があることを検証する。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReviewList from '../ReviewList';
import type { FacilityReview } from '@/types';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/facility/test-salon',
}));

const mockGetUser = jest.fn();
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getUser: () => mockGetUser() },
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: [] }),
        eq: () => ({ in: () => Promise.resolve({ data: [] }) }),
      }),
    }),
  }),
}));

const REVIEW: FacilityReview = {
  id: 'review-1',
  facility_id: 'fac-1',
  user_id: null,
  reviewer_name: 'テスト太郎',
  rating: 4.5,
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
  jest.clearAllMocks();
  global.fetch = jest.fn() as unknown as typeof fetch;
});

test('未ログイン時に通報ボタンを押すと「ログインが必要です」ダイアログを表示し、通報確認ダイアログは出さない', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });

  render(<ReviewList reviews={[REVIEW]} />);

  fireEvent.click(screen.getByRole('button', { name: 'この口コミを通報する' }));

  await waitFor(() => {
    expect(screen.getByText('ログインが必要です')).toBeInTheDocument();
  });
  expect(screen.getByText('通報にはログインが必要です。ログインしてからもう一度お試しください。')).toBeInTheDocument();
  expect(screen.queryByText('この口コミを不正・不適切として通報しますか？')).not.toBeInTheDocument();
  // 未ログイン確認のみ行い、通報 API はまだ呼ばれない
  expect(global.fetch).not.toHaveBeenCalled();
});

test('ログインが必要ですダイアログの「ログインする」で /auth/login?redirect=現在ページ へ遷移する', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });

  render(<ReviewList reviews={[REVIEW]} />);

  fireEvent.click(screen.getByRole('button', { name: 'この口コミを通報する' }));
  await waitFor(() => {
    expect(screen.getByText('ログインが必要です')).toBeInTheDocument();
  });

  fireEvent.click(screen.getByRole('button', { name: 'ログインする' }));

  expect(mockPush).toHaveBeenCalledWith(
    `/auth/login?redirect=${encodeURIComponent('/facility/test-salon')}`
  );
});

test('未ログイン時、ダイアログを「キャンセル」で閉じられる', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });

  render(<ReviewList reviews={[REVIEW]} />);

  fireEvent.click(screen.getByRole('button', { name: 'この口コミを通報する' }));
  await waitFor(() => {
    expect(screen.getByText('ログインが必要です')).toBeInTheDocument();
  });

  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));

  await waitFor(() => {
    expect(screen.queryByText('ログインが必要です')).not.toBeInTheDocument();
  });
  expect(mockPush).not.toHaveBeenCalled();
});

test('ログイン済みなら通報確認ダイアログが出て、確定すると /api/report を呼ぶ', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } } });
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ success: true }),
  });

  render(<ReviewList reviews={[REVIEW]} />);

  fireEvent.click(screen.getByRole('button', { name: 'この口コミを通報する' }));

  await waitFor(() => {
    expect(screen.getByText('この口コミを不正・不適切として通報しますか？')).toBeInTheDocument();
  });
  expect(screen.queryByText('ログインが必要です')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '通報する' }));

  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/report',
      expect.objectContaining({ method: 'POST' })
    );
  });
});

test('通報 API が 401 を返した場合（セッション失効等）、ログイン誘導ダイアログとエラーTOASTを表示する', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } } });
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: false,
    status: 401,
    json: () => Promise.resolve({ error: '認証が必要です' }),
  });

  render(<ReviewList reviews={[REVIEW]} />);

  fireEvent.click(screen.getByRole('button', { name: 'この口コミを通報する' }));
  await waitFor(() => {
    expect(screen.getByText('この口コミを不正・不適切として通報しますか？')).toBeInTheDocument();
  });

  fireEvent.click(screen.getByRole('button', { name: '通報する' }));

  // Toast とダイアログの両方に同一メッセージが出る想定のため getAllByText で確認する
  await waitFor(() => {
    expect(
      screen.getAllByText('通報にはログインが必要です。ログインしてからもう一度お試しください。').length
    ).toBeGreaterThanOrEqual(1);
  });
  expect(screen.getByText('ログインが必要です')).toBeInTheDocument();
});
