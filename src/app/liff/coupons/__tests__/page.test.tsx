/**
 * @jest-environment jsdom
 *
 * LIFF クーポンページの取得失敗可視化 回帰テスト。
 * 旧実装は .catch で setLoading(false) のみで、取得失敗を「クーポンはありません」と区別できなかった。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import LiffCouponsPage from '@/app/liff/coupons/page';
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
  render(<LiffCouponsPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('クーポン情報の取得に失敗しました');
});

test('取得成功 → 通常表示しエラーは出さない（正常系不変）', async () => {
  mockFetch(true, { coupons: [] });
  render(<LiffCouponsPage />);
  expect(await screen.findByText('クーポン')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('DB CHECK制約の正値(percentage/special_price/limited_time)を正しく表示する（SSOTドリフト回帰防止）', async () => {
  mockFetch(true, {
    coupons: [
      {
        id: 'c1',
        name: '20%OFFクーポン',
        description: null,
        discount_type: 'percentage',
        discount_value: 20,
        special_price: null,
        valid_until: null,
        coupon_type: 'limited_time',
        facility_profiles: null,
      },
      {
        id: 'c2',
        name: '特別価格クーポン',
        description: null,
        discount_type: 'special_price',
        discount_value: null,
        special_price: 3000,
        valid_until: null,
        coupon_type: 'new_customer',
        facility_profiles: null,
      },
    ],
  });
  render(<LiffCouponsPage />);
  expect(await screen.findByText('20%OFF')).toBeInTheDocument();
  expect(screen.getByText('期間限定')).toBeInTheDocument();
  expect(screen.getByText('¥3,000')).toBeInTheDocument();
  expect(screen.getByText('新規限定')).toBeInTheDocument();
  // 旧バグでは discount_type='percentage'/'special_price' が '特別割引' に、
  // coupon_type='limited_time' が '全員' に誤表示されていた
  expect(screen.queryByText('全員')).not.toBeInTheDocument();
  expect(screen.queryAllByText('特別割引')).toHaveLength(0);
});
