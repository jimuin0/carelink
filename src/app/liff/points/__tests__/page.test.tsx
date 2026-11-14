/**
 * @jest-environment jsdom
 *
 * LIFF ポイントページの取得失敗可視化 回帰テスト。
 * 旧実装は .catch で setLoading(false) のみで、取得失敗を「0pt・履歴なし」と区別できなかった。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import LiffPointsPage from '@/app/liff/points/page';
import { useLiff } from '@/hooks/useLiff';

jest.mock('@/hooks/useLiff', () => ({ useLiff: jest.fn() }));

function mockFetch(ok: boolean, body: object) {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) }),
  ) as unknown as typeof fetch;
}

beforeEach(() =>
  (useLiff as jest.Mock).mockReturnValue({
    status: 'ready',
    accessToken: 'tok',
    data: { display_name: 'テスト' },
  }),
);
afterEach(() => jest.clearAllMocks());

test('取得失敗(500) → エラーを明示する（握り潰し回帰防止）', async () => {
  mockFetch(false, {});
  render(<LiffPointsPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('ポイント情報の取得に失敗しました');
});

test('取得成功 → 取得した残高と履歴を表示しエラーは出さない（0pt 扱いへの退行を検知）', async () => {
  mockFetch(true, { logs: [
    { id: 'l1', points: 500, reason: '紹介ボーナス', created_at: '2026-05-01T00:00:00Z' },
    { id: 'l2', points: -100, reason: '割引使用', created_at: '2026-04-15T00:00:00Z' },
  ], total: 1200 });
  render(<LiffPointsPage />);
  expect(await screen.findByText('保有ポイント')).toBeInTheDocument();
  expect(await screen.findByText('1,200')).toBeInTheDocument();
  expect(screen.getByText('紹介ボーナス')).toBeInTheDocument();
  expect(screen.getByText('+500pt')).toBeInTheDocument();
  expect(screen.getByText('-100pt')).toBeInTheDocument();
  expect(screen.queryByText('ポイント履歴はありません')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('取得成功（履歴0件）→ 空の案内を出し、エラーは出さない', async () => {
  mockFetch(true, { logs: [], total: 0 });
  render(<LiffPointsPage />);
  expect(await screen.findByText('ポイント履歴はありません')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
