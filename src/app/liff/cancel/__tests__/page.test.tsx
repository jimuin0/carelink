/**
 * @jest-environment jsdom
 *
 * LIFF 予約キャンセルページの取得失敗可視化 回帰テスト。
 * 旧実装は .catch で setLoading(false) のみで、取得失敗を「予約が見つかりません」と区別できなかった。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import LiffCancelPage from '@/app/liff/cancel/page';
import { useLiff } from '@/hooks/useLiff';

jest.mock('@/hooks/useLiff', () => ({ useLiff: jest.fn() }));
jest.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => 'booking-1' }),
}));

function mockFetch(ok: boolean, body: object) {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) }),
  ) as unknown as typeof fetch;
}

beforeEach(() =>
  (useLiff as jest.Mock).mockReturnValue({ status: 'ready', accessToken: 'tok', data: {} }),
);
afterEach(() => jest.clearAllMocks());

test('取得失敗(500) → 「見つかりません」でなくエラーを明示する（握り潰し回帰防止）', async () => {
  mockFetch(false, {});
  render(<LiffCancelPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('予約情報の取得に失敗しました');
});

test('arrived(来店中)の予約はキャンセルボタンを表示する（SSOTドリフト回帰防止・API/Web版と同じ挙動）', async () => {
  mockFetch(true, {
    booking: {
      id: 'booking-1',
      booking_date: '2026-07-20',
      start_time: '10:00:00',
      menu_name: 'テスト施術',
      status: 'arrived',
      facility_profiles: { name: 'テスト施設' },
    },
  });
  render(<LiffCancelPage />);
  expect(await screen.findByText('この予約をキャンセルする')).toBeInTheDocument();
  expect(screen.queryByText(/この予約はキャンセルできません/)).not.toBeInTheDocument();
});

test('completed(施術済)の予約はキャンセルボタンを表示しない（キャンセル不可ステータスは従来通り）', async () => {
  mockFetch(true, {
    booking: {
      id: 'booking-1',
      booking_date: '2026-07-20',
      start_time: '10:00:00',
      menu_name: 'テスト施術',
      status: 'completed',
      facility_profiles: { name: 'テスト施設' },
    },
  });
  render(<LiffCancelPage />);
  expect(await screen.findByText(/この予約はキャンセルできません/)).toBeInTheDocument();
  expect(screen.queryByText('この予約をキャンセルする')).not.toBeInTheDocument();
});
