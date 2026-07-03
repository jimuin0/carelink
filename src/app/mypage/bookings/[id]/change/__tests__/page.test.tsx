/**
 * @jest-environment jsdom
 *
 * 予約変更ページの空き枠取得失敗可視化 回帰テスト。
 * 旧実装は res.ok を検証せず、エラー応答(JSON)で data.slots=undefined → 空配列となり
 * 「空き枠なし」と障害が区別不能だった。res.ok を検証しエラートーストへ流す。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import BookingChangePage from '@/app/mypage/bookings/[id]/change/page';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useParams: () => ({ id: 'b1' }),
}));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: jest.fn() }));

const BOOKING = {
  id: 'b1', facility_id: 'f1', staff_id: 's1', menu_id: 'm1',
  booking_date: '2026-06-01', start_time: '10:00:00', end_time: '11:00:00',
  total_price: 5000, status: 'confirmed',
};

function chain(data: unknown) {
  const obj: Record<string, unknown> = {
    select: () => obj,
    eq: () => obj,
    single: () => Promise.resolve({ data, error: null }),
  };
  return obj;
}

function mockSupabase() {
  const byTable: Record<string, unknown> = {
    bookings: BOOKING,
    facility_profiles: { name: 'テスト施設' },
    facility_menus: { name: 'メニュー', duration_minutes: 60 },
    staff_profiles: { name: 'スタッフ' },
  };
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => chain(byTable[table]),
  });
}

afterEach(() => jest.clearAllMocks());

test('空き枠の取得失敗(500) → 「空き枠なし」でなくエラートーストを出す（回帰防止）', async () => {
  mockSupabase();
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }),
  ) as unknown as typeof fetch;

  render(<BookingChangePage />);
  // 予約読込後、日付グリッドが表示される
  await screen.findByText('新しい日付を選択');
  // 先頭の日付ボタンを選択 → useEffect で空き枠取得が走る
  fireEvent.click(screen.getAllByRole('button')[0]);
  expect(await screen.findByText('空き枠の取得に失敗しました')).toBeInTheDocument();
});

test('所要時間は予約の start/end 差から算出する（G6・複数メニュー予約が先頭メニュー分に縮まない）', async () => {
  // start 10:00〜end 12:00 の120分予約 → duration=120 で /api/slots を引く（menu の duration_minutes に依存しない）。
  const byTable: Record<string, unknown> = {
    bookings: { ...BOOKING, start_time: '10:00:00', end_time: '12:00:00' },
    facility_profiles: { name: 'テスト施設' },
    facility_menus: { name: 'メニュー' },
    staff_profiles: { name: 'スタッフ' },
  };
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => chain(byTable[table]),
  });
  const fetchMock = jest.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ slots: [] }) }),
  );
  global.fetch = fetchMock as unknown as typeof fetch;

  render(<BookingChangePage />);
  await screen.findByText('新しい日付を選択');
  fireEvent.click(screen.getAllByRole('button')[0]);
  await screen.findByText('この日は予約可能な時間帯がありません');
  expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('duration=120'))).toBe(true);
});

test('start>=end の異常予約は所要時間 60 分にフォールバック（G6・durationMinutes 防御分岐）', async () => {
  const byTable: Record<string, unknown> = {
    bookings: { ...BOOKING, start_time: '10:00:00', end_time: '10:00:00' },
    facility_profiles: { name: 'テスト施設' },
    facility_menus: { name: 'メニュー' },
    staff_profiles: { name: 'スタッフ' },
  };
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => chain(byTable[table]),
  });
  const fetchMock = jest.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ slots: [] }) }),
  );
  global.fetch = fetchMock as unknown as typeof fetch;

  render(<BookingChangePage />);
  await screen.findByText('新しい日付を選択');
  fireEvent.click(screen.getAllByRole('button')[0]);
  await screen.findByText('この日は予約可能な時間帯がありません');
  expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('duration=60'))).toBe(true);
});
