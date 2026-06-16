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
