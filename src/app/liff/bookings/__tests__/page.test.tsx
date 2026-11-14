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

// リッチメニューの「キャンセル」から一覧に来たお客様が、キャンセルする予約を選べること。以前は一覧の予約にリンクが無かった。
test('キャンセルできる予約だけに、その予約のキャンセル画面へのリンクを出す', async () => {
  mockFetch(true, { bookings: [
    { id: 'b-open', booking_date: '2099-07-20', start_time: '10:00:00', end_time: '11:00:00', status: 'confirmed', menu_name: 'A', total_price: null },
    { id: 'b-done', booking_date: '2026-07-20', start_time: '10:00:00', end_time: '11:00:00', status: 'completed', menu_name: 'B', total_price: null },
  ] });
  render(<LiffBookingsPage />);
  const links = await screen.findAllByRole('link', { name: 'キャンセル手続きへ' });
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute('href', '/liff/cancel?booking_id=b-open');
});

test('日付をまたぐ予約は翌日終了と表示する', async () => {
  mockFetch(true, {bookings:[{id:'b-night',booking_date:'2099-07-20',end_date:'2099-07-21',start_time:'23:30',end_time:'00:30',status:'confirmed',menu_name:'A',total_price:null}]});
  render(<LiffBookingsPage />);
  expect(await screen.findByText('23:30〜翌00:30')).toBeInTheDocument();
});

describe('未連携の案内', () => {
  const original = process.env.NEXT_PUBLIC_LINE_CHANNEL_ID;
  const originalLiff = process.env.NEXT_PUBLIC_LIFF_ID;
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_LINE_CHANNEL_ID; else process.env.NEXT_PUBLIC_LINE_CHANNEL_ID = original;
    if (originalLiff === undefined) delete process.env.NEXT_PUBLIC_LIFF_ID; else process.env.NEXT_PUBLIC_LIFF_ID = originalLiff;
  });

  test('連携できる環境では「LINEと連携する」で設定ページの連携ボタンへ案内する', () => {
    process.env.NEXT_PUBLIC_LIFF_ID = 'synthetic-liff'; process.env.NEXT_PUBLIC_LINE_CHANNEL_ID = 'synthetic-channel';
    (useLiff as jest.Mock).mockReturnValue({ status: 'not_linked' });
    render(<LiffBookingsPage />);
    expect(screen.getByRole('link', { name: 'LINEと連携する' })).toHaveAttribute('href', '/mypage/settings');
    expect(screen.queryByText('設定ページへ')).not.toBeInTheDocument();
  });

  test('LINE ログイン未設定では連携ボタンを出さない', () => {
    process.env.NEXT_PUBLIC_LIFF_ID = 'synthetic-liff'; delete process.env.NEXT_PUBLIC_LINE_CHANNEL_ID;
    (useLiff as jest.Mock).mockReturnValue({ status: 'not_linked' });
    render(<LiffBookingsPage />);
    expect(screen.queryByRole('link', { name: 'LINEと連携する' })).not.toBeInTheDocument();
    expect(screen.getByText('現在、LINE連携の受付を停止しています。')).toBeInTheDocument();
  });
});
