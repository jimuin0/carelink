/**
 * @jest-environment jsdom
 *
 * LIFF 予約キャンセルページの取得失敗可視化 回帰テスト。
 * 旧実装は .catch で setLoading(false) のみで、取得失敗を「予約が見つかりません」と区別できなかった。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LiffCancelPage from '@/app/liff/cancel/page';
import { useLiff } from '@/hooks/useLiff';

jest.mock('@/hooks/useLiff', () => ({ useLiff: jest.fn() }));
let mockBookingParam: string | null = 'booking-1';
const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => mockBookingParam }),
  useRouter: () => ({ replace: mockReplace }),
}));

function mockFetch(ok: boolean, body: object) {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) }),
  ) as unknown as typeof fetch;
}

beforeEach(() =>
  (useLiff as jest.Mock).mockReturnValue({ status: 'ready', accessToken: 'tok', data: {} }),
);
afterEach(() => { jest.clearAllMocks(); mockBookingParam = 'booking-1'; });

test('取得失敗(500) → 「見つかりません」でなくエラーを明示する（握り潰し回帰防止）', async () => {
  mockFetch(false, {});
  render(<LiffCancelPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('予約情報の取得に失敗しました');
});

test('arrived(来店中)の予約はキャンセルボタンを表示する（SSOTドリフト回帰防止・API/Web版と同じ挙動）', async () => {
  mockFetch(true, {
    booking: {
      id: 'booking-1',
      booking_date: '2099-07-20',
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

// 店舗が「ネットでのキャンセル不可（店舗へ直接ご連絡）」を選んでいる（/api/liff/bookings の online_cancel_allowed=false）。
// 押しても API が必ず断るボタンを出さず、店舗への連絡を案内する（2026年10月23日）。
test('ネットでのキャンセル不可の店舗 → キャンセルボタンの代わりに店舗への連絡を案内する', async () => {
  mockFetch(true, {
    booking: {
      id: 'booking-1', booking_date: '2099-07-20', start_time: '10:00:00', menu_name: 'テスト施術',
      status: 'confirmed', facility_profiles: { name: 'テスト施設' }, online_cancel_allowed: false,
    },
  });
  render(<LiffCancelPage />);
  expect(await screen.findByText('この店舗ではネットからのキャンセルをお受けしていません。キャンセルをご希望の場合は、店舗へ直接ご連絡ください。')).toBeInTheDocument();
  expect(screen.queryByText('この予約をキャンセルする')).not.toBeInTheDocument();
  expect(screen.getByText('戻る')).toBeInTheDocument();
});

test('ネットからキャンセルできる店舗（online_cancel_allowed=true）→ 従来どおりボタンを表示', async () => {
  mockFetch(true, {
    booking: {
      id: 'booking-1', booking_date: '2099-07-20', start_time: '10:00:00', menu_name: 'テスト施術',
      status: 'confirmed', facility_profiles: { name: 'テスト施設' }, online_cancel_allowed: true,
    },
  });
  render(<LiffCancelPage />);
  expect(await screen.findByText('この予約をキャンセルする')).toBeInTheDocument();
});

test('キャンセル済みの予約は、店舗の設定に関わらず「キャンセルできません」のまま', async () => {
  mockFetch(true, {
    booking: {
      id: 'booking-1', booking_date: '2026-07-20', start_time: '10:00:00', menu_name: 'テスト施術',
      status: 'cancelled', facility_profiles: { name: 'テスト施設' }, online_cancel_allowed: false,
    },
  });
  render(<LiffCancelPage />);
  expect(await screen.findByText(/この予約はキャンセルできません/)).toBeInTheDocument();
  expect(screen.queryByText(/ネットからのキャンセルをお受けしていません/)).not.toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// 「店舗へ直接ご連絡ください」には連絡手段を添える／開始後はキャンセルボタンを出さない（2026年10月23日）。
// ---------------------------------------------------------------------------
const STARTED = '開始時刻を過ぎた予約は、オンラインで日時の変更やキャンセルができません。店舗へ直接ご連絡ください。';
const CONTACT = { slug: 'test-salon', phone: '03-1234-5678' };
const FUTURE = { id: 'booking-1', booking_date: '2099-07-20', start_time: '10:00:00', menu_name: 'テスト施術', facility_profiles: { name: 'テスト施設' }, total_price: 5000 };

test.each(['confirmed', 'arrived'])('開始時刻を過ぎた %s 予約 → キャンセルボタンを出さず、電話と店舗ページを添えて連絡を案内する', async (status) => {
  mockFetch(true, { booking: { ...FUTURE, booking_date: '2020-07-20', status, facility_contact: CONTACT, online_cancel_allowed: true } });
  render(<LiffCancelPage />);
  expect(await screen.findByText(STARTED)).toBeInTheDocument();
  expect(screen.queryByText('この予約をキャンセルする')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '店舗に電話する（03-1234-5678）' })).toHaveAttribute('href', 'tel:03-1234-5678');
  expect(screen.getByRole('link', { name: '店舗ページを見る' })).toHaveAttribute('href', '/facility/test-salon');
});

test('ネットでのキャンセル不可の店舗 → 案内に電話と店舗ページを添える', async () => {
  mockFetch(true, { booking: { ...FUTURE, status: 'confirmed', facility_contact: CONTACT, online_cancel_allowed: false } });
  render(<LiffCancelPage />);
  expect(await screen.findByText(/ネットからのキャンセルをお受けしていません/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '店舗に電話する（03-1234-5678）' })).toHaveAttribute('href', 'tel:03-1234-5678');
  expect(screen.getByRole('link', { name: '店舗ページを見る' })).toHaveAttribute('href', '/facility/test-salon');
});

test('非公開の店舗（連絡先なし）→ 案内だけ出し、壊れたリンクは出さない', async () => {
  mockFetch(true, { booking: { ...FUTURE, status: 'confirmed', facility_contact: null, online_cancel_allowed: false } });
  render(<LiffCancelPage />);
  expect(await screen.findByText(/ネットからのキャンセルをお受けしていません/)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /店舗に電話する/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '店舗ページを見る' })).not.toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// キャンセル料の見込みを押す前に出し、キャンセル後は API が返した確定額を出す（2026年10月23日）。
// 以前は「キャンセル料が発生する場合があります」の固定文言で、API の cancelFee は捨てていた。
// ---------------------------------------------------------------------------
function liffFetch(booking: unknown, cancelBody: unknown) {
  global.fetch = jest.fn(async (url: string) => {
    if (String(url).startsWith('/api/liff/bookings')) return { ok: true, status: 200, json: async () => ({ booking }) };
    return { ok: true, status: 200, json: async () => cancelBody };
  }) as unknown as typeof fetch;
}
const cancelCalls = () => (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes('/cancel'));
const ALWAYS = { free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'always_fee' };
const WINDOW = { free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'free_window' };

test('常にキャンセル料の店舗 → 押す前に金額と料率を出し、キャンセル後は API の確定額を出す', async () => {
  liffFetch({ ...FUTURE, status: 'confirmed', online_cancel_allowed: true, cancel_policy: ALWAYS }, { success: true, cancelFee: 2500 });
  render(<LiffCancelPage />);
  expect(await screen.findByText(/キャンセル料 ¥2,500（施術料金の50%）がかかります/)).toBeInTheDocument();
  expect(screen.queryByText(/発生する場合があります/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('この予約をキャンセルする'));
  expect(await screen.findByText('キャンセル料 ¥2,500 が発生します。お支払い方法は店舗からご案内します。')).toBeInTheDocument();
  expect(screen.getByText('キャンセルが完了しました')).toBeInTheDocument();
});

test('ポリシー未設定の店舗 → 無料とはっきり出す', async () => {
  liffFetch({ ...FUTURE, status: 'confirmed', online_cancel_allowed: true, cancel_policy: null }, { success: true, cancelFee: 0 });
  render(<LiffCancelPage />);
  expect(await screen.findByText(/キャンセルすると元に戻せません。キャンセル料はかかりません。/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('この予約をキャンセルする'));
  expect(await screen.findByText('キャンセル料はかかりません。')).toBeInTheDocument();
});

test('ポリシーを読めなかった（cancel_policy なし）→ 金額を推測せず従来の案内', async () => {
  liffFetch({ ...FUTURE, status: 'confirmed', online_cancel_allowed: true }, { success: true });
  render(<LiffCancelPage />);
  expect(await screen.findByText(/キャンセルポリシーによりキャンセル料が発生する場合があります/)).toBeInTheDocument();
  fireEvent.click(screen.getByText('この予約をキャンセルする'));
  expect(await screen.findByText('キャンセルが完了しました')).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('表示してから無料期限を過ぎた → 押しても取り消さず新しい金額を見せ直し、もう一度押して初めて取り消す', async () => {
  const START_MS = Date.UTC(2099, 6, 20, 1, 0, 0); // 2099-07-20 10:00 JST
  const now = jest.spyOn(Date, 'now').mockReturnValue(START_MS - 25 * 3_600_000);
  try {
    liffFetch({ ...FUTURE, status: 'confirmed', online_cancel_allowed: true, cancel_policy: WINDOW }, { success: true, cancelFee: 2500 });
    render(<LiffCancelPage />);
    expect(await screen.findByText(/キャンセル料はかかりません（予約日時の24時間前まで無料）/)).toBeInTheDocument();
    now.mockReturnValue(START_MS - 23 * 3_600_000);
    fireEvent.click(screen.getByText('この予約をキャンセルする'));
    expect(await screen.findByText(/キャンセル料の条件が変わりました。内容をご確認ください。/)).toBeInTheDocument();
    expect(screen.getByText(/キャンセル料 ¥2,500（施術料金の50%）がかかります/)).toBeInTheDocument();
    expect(cancelCalls()).toHaveLength(0);
    fireEvent.click(screen.getByText('この予約をキャンセルする'));
    expect(await screen.findByText('キャンセル料 ¥2,500 が発生します。お支払い方法は店舗からご案内します。')).toBeInTheDocument();
    expect(cancelCalls()).toHaveLength(1);
  } finally {
    now.mockRestore();
  }
});

// リッチメニューの「キャンセル」は予約を指定せずに開く。以前は「予約IDが指定されていません」で行き止まりだった。
test('予約の指定が無ければ、予約を選べる一覧へ移す（予約を読みに行かない）', async () => {
  mockBookingParam = null;
  mockFetch(true, {});
  render(<LiffCancelPage />);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/liff/bookings'));
  expect(screen.getByRole('link', { name: '予約一覧へ' })).toHaveAttribute('href', '/liff/bookings');
  expect(screen.queryByText('予約IDが指定されていません')).not.toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('予約の指定があれば一覧へは移さない', async () => {
  mockFetch(true, { booking: null });
  render(<LiffCancelPage />);
  expect(await screen.findByText('予約が見つかりません')).toBeInTheDocument();
  expect(mockReplace).not.toHaveBeenCalled();
});

// キャンセルの応答が届かない・5xx のとき「失敗」と言い切らず、予約の今の状態で伝える（点検 B8-M5）。
describe('キャンセル結果が不明なとき', () => {
  function uncertainFetch(cancel: 'throw' | 500, statusAfter: string | null) {
    let reads = 0;
    global.fetch = jest.fn(async (url: string) => {
      if (String(url).startsWith('/api/liff/bookings')) {
        reads++;
        if (reads > 1 && statusAfter === null) throw new Error('offline');
        return { ok: true, status: 200, json: async () => ({ booking: { ...FUTURE, status: reads > 1 ? statusAfter : 'confirmed', online_cancel_allowed: true } }) };
      }
      if (cancel === 'throw') throw new Error('timeout');
      return { ok: false, status: 500, json: async () => ({ error: 'x' }) };
    }) as unknown as typeof fetch;
  }

  test.each(['throw', 500] as const)('%s でも実際にキャンセル済みなら完了と表示する', async (mode) => {
    uncertainFetch(mode, 'cancelled');
    render(<LiffCancelPage />);
    fireEvent.click(await screen.findByText('この予約をキャンセルする'));
    expect(await screen.findByText('キャンセルが完了しました')).toBeInTheDocument();
  });

  test('キャンセルされていなければ「確認できない」と案内する（失敗と断定しない）', async () => {
    uncertainFetch('throw', 'confirmed');
    render(<LiffCancelPage />);
    fireEvent.click(await screen.findByText('この予約をキャンセルする'));
    expect(await screen.findByText(/キャンセルの結果を確認できませんでした/)).toBeInTheDocument();
  });

  test('状態の読み直しも失敗したら「確認できない」と案内する', async () => {
    uncertainFetch('throw', null);
    render(<LiffCancelPage />);
    fireEvent.click(await screen.findByText('この予約をキャンセルする'));
    expect(await screen.findByText(/キャンセルの結果を確認できませんでした/)).toBeInTheDocument();
  });
});

// 監査 A196: booking_id を URL エンコードせず連結しており、任意のクエリを API へ足せた。
test('booking_id は URL エンコードして API へ渡す（クエリを注入できない）', async () => {
  mockBookingParam = 'b1&facility_id=other';
  mockFetch(false, {});
  render(<LiffCancelPage />);
  await screen.findByRole('alert');
  expect(global.fetch).toHaveBeenCalledWith('/api/liff/bookings?booking_id=b1%26facility_id%3Dother', expect.anything());
});
