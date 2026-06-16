/**
 * @jest-environment jsdom
 *
 * LIFF 予約一覧ページの取得失敗可視化 回帰テスト。
 * 旧実装は .catch で setLoading(false) のみで、取得失敗を「予約はありません」と区別できなかった。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import LiffBookingsPage from '@/app/liff/bookings/page';
import { useLiff } from '@/hooks/useLiff';

jest.mock('@/hooks/useLiff', () => ({ useLiff: jest.fn() }));

function mockFetch(ok: boolean, body: object) {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) }),
  ) as unknown as typeof fetch;
}

beforeEach(() =>
  (useLiff as jest.Mock).mockReturnValue({ status: 'ready', accessToken: 'tok', data: {} }),
);
afterEach(() => jest.clearAllMocks());

test('取得失敗(500) → エラーを明示する（握り潰し回帰防止）', async () => {
  mockFetch(false, {});
  render(<LiffBookingsPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('予約情報の取得に失敗しました');
});

test('取得成功 → 通常表示しエラーは出さない（正常系不変）', async () => {
  mockFetch(true, { bookings: [] });
  render(<LiffBookingsPage />);
  expect(await screen.findByText('予約確認')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
