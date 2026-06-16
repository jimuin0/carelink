/**
 * @jest-environment jsdom
 *
 * 紹介プログラムページの取得失敗可視化 回帰テスト。
 * 旧実装は .catch で setLoading(false) のみで、取得失敗を「コード未発行・0人」と区別できなかった。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import ReferralPage from '@/app/mypage/referral/page';

function mockFetch(ok: boolean, body: object) {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) }),
  ) as unknown as typeof fetch;
}

afterEach(() => jest.clearAllMocks());

test('取得失敗(500) → エラーを明示する（握り潰し回帰防止）', async () => {
  mockFetch(false, {});
  render(<ReferralPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('招待情報の取得に失敗しました');
});

test('取得成功 → 通常表示しエラーは出さない（正常系不変）', async () => {
  mockFetch(true, { code: 'ABC123', used_count: 2, already_referred: false });
  render(<ReferralPage />);
  expect(await screen.findByText('友達招待プログラム')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
