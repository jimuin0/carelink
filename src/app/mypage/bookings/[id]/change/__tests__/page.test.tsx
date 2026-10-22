/**
 * @jest-environment jsdom
 *
 * 予約日時の変更ページの空き枠取得。
 *
 * 2026年10月22日：おまかせ予約は以前スタッフの人数ぶん /api/slots を同時に叩き、失敗や 429 を
 * 空配列として扱っていたため、上限に当たると「この日は予約可能な時間帯がありません」と表示していた。
 * 今は /api/slots/week（10人ずつ）でまとめて取り、失敗は「空きなし」と区別して再試行を出す。
 * おまかせ予約の集計対象は、予約したメニューを担当できるスタッフ（menu_staff）に絞る。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import BookingChangePage from '@/app/mypage/bookings/[id]/change/page';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { requestedStaffIds, slotsWeekBody } from '@/test-utils/slots-week-mock';

// 実際の useRouter は同じオブジェクトを返し続ける。毎回新しいオブジェクトを返すと、読み込みの
// effect（依存に router を含む）が描画のたびに走り直し、予約を読み直して空き枠も取り直してしまう。
const mockRouter = { push: jest.fn(), back: jest.fn() };
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useParams: () => ({ id: 'b1' }),
}));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: jest.fn() }));

const BOOKING = {
  id: 'b1', facility_id: 'f1', staff_id: 's1', menu_id: 'm1', menu_ids: null as string[] | null,
  booking_date: '2026-06-01', start_time: '10:00:00', end_time: '11:00:00',
  total_price: 5000, status: 'confirmed',
};

type Tables = {
  booking?: Partial<typeof BOOKING>;
  staff?: { id: string }[];
  staffError?: unknown;
  menuStaff?: { menu_id: string; staff_id: string }[];
  menuStaffError?: unknown;
};

const menuStaffIn = jest.fn();

/** テーブルごとに返すデータを変えられる Supabase クライアントのモック。 */
function mockSupabase(t: Tables = {}) {
  const single: Record<string, unknown> = {
    bookings: { ...BOOKING, ...t.booking },
    facility_profiles: { name: 'テスト施設' },
    facility_menus: { name: 'メニュー' },
    staff_profiles: { name: 'スタッフ' },
  };
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.single = () => Promise.resolve({ data: single[table], error: null });
      // スタッフ一覧（おまかせの集計対象）
      chain.order = () => Promise.resolve({ data: t.staffError ? null : (t.staff ?? []), error: t.staffError ?? null });
      // menu_staff（担当スタッフ制）
      chain.in = (...args: unknown[]) => {
        menuStaffIn(table, ...args);
        return Promise.resolve({ data: t.menuStaffError ? null : (t.menuStaff ?? []), error: t.menuStaffError ?? null });
      };
      return chain;
    },
  });
}

type SlotLike = { slot_start: string; slot_end: string };
let fetchMock: jest.Mock;

/** /api/slots/week の応答を順に返す fetch モック（足りなければ最後の応答を繰り返す）。 */
function mockFetch(...responses: (((url: string) => unknown) | { status: number })[]) {
  let call = 0;
  fetchMock = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const r = responses[Math.min(call++, responses.length - 1)];
    if (typeof r !== 'function') return Promise.resolve({ ok: false, status: r.status, json: () => Promise.resolve({ error: 'x', days: {} }) } as Response);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(r(url)) } as Response);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
}

const slotsFor = (slots: SlotLike[] | ((staffId: string) => SlotLike[])) => (url: string) =>
  slotsWeekBody(url, typeof slots === 'function' ? (staffId) => slots(staffId) : slots);

async function pickFirstDate() {
  await screen.findByText('新しい日付を選択');
  fireEvent.click(screen.getAllByRole('button')[0]);
}

const slotPicker = () => screen.getByTestId('slot-picker');

afterEach(() => jest.clearAllMocks());

describe('指名予約', () => {
  test('当該スタッフの空き枠を /api/slots/week（選んだ1日分）で取得して表示する', async () => {
    mockSupabase();
    mockFetch(slotsFor([{ slot_start: '13:00:00', slot_end: '14:00:00' }]));
    render(<BookingChangePage />);
    await pickFirstDate();
    expect(await within(slotPicker()).findByText('13:00')).toBeInTheDocument();
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost');
    expect(url.pathname).toBe('/api/slots/week');
    expect(url.searchParams.get('staffIds')).toBe('s1');
    expect(url.searchParams.get('dates')?.split(',')).toHaveLength(1);
    expect(url.searchParams.get('facilityId')).toBe('f1');
  });

  test('取得失敗(500) → 「空きなし」でなく失敗を表示し、再試行で取り直せる（回帰防止）', async () => {
    mockSupabase();
    mockFetch({ status: 500 }, slotsFor([{ slot_start: '15:00:00', slot_end: '16:00:00' }]));
    render(<BookingChangePage />);
    await pickFirstDate();
    expect(await within(slotPicker()).findByRole('alert')).toHaveTextContent('空き枠を取得できませんでした');
    expect(within(slotPicker()).queryByText('この日は予約可能な時間帯がありません')).not.toBeInTheDocument();

    fireEvent.click(within(slotPicker()).getByRole('button', { name: '再試行' }));
    expect(await within(slotPicker()).findByText('15:00')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('所要時間は予約の start/end 差から算出する（複数メニュー予約が先頭メニュー分に縮まない）', async () => {
    mockSupabase({ booking: { start_time: '10:00:00', end_time: '12:00:00' } });
    mockFetch(slotsFor([]));
    render(<BookingChangePage />);
    await pickFirstDate();
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('duration=120'))).toBe(true);
    });
  });

  test('start>=end の異常予約は所要時間 60 分にフォールバック', async () => {
    mockSupabase({ booking: { start_time: '10:00:00', end_time: '10:00:00' } });
    mockFetch(slotsFor([]));
    render(<BookingChangePage />);
    await pickFirstDate();
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('duration=60'))).toBe(true);
    });
    expect(await within(slotPicker()).findByText('この日は予約可能な時間帯がありません')).toBeInTheDocument();
  });

  test('店舗のネット予約が準備中なら、その旨を表示する（空きなしと言わない）', async () => {
    mockSupabase();
    mockFetch(() => ({ days: {}, bookingAvailable: false }));
    render(<BookingChangePage />);
    await pickFirstDate();
    expect(await within(slotPicker()).findByText('この店舗のネット予約は準備中です。日時の変更は店舗へ直接お問い合わせください。')).toBeInTheDocument();
  });

  test('応答の形が違う（days が無い）ときも取得失敗として扱う', async () => {
    mockSupabase();
    mockFetch(() => ({ unexpected: true }));
    render(<BookingChangePage />);
    await pickFirstDate();
    expect(await within(slotPicker()).findByRole('alert')).toHaveTextContent('空き枠を取得できませんでした');
  });
});

describe('おまかせ予約（staff_id=NULL）', () => {
  const staff12 = Array.from({ length: 12 }, (_, i) => ({ id: `st${String(i + 1).padStart(2, '0')}` }));

  test('スタッフ12人は10人ずつ2リクエストで取得し、同じ開始時刻は表示順で先のスタッフの枠を採る', async () => {
    mockSupabase({ booking: { staff_id: null }, staff: staff12 });
    mockFetch(slotsFor((staffId) => (staffId === 'st03' || staffId === 'st11')
      ? [{ slot_start: '10:00:00', slot_end: '11:00:00' }]
      : staffId === 'st12' ? [{ slot_start: '09:00:00', slot_end: '10:00:00' }] : []));
    render(<BookingChangePage />);
    await pickFirstDate();
    expect(await within(slotPicker()).findByText('09:00')).toBeInTheDocument();
    expect(within(slotPicker()).getByText('10:00')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every((c) => String(c[0]).includes('/api/slots/week'))).toBe(true);
    expect(requestedStaffIds(fetchMock.mock.calls)).toEqual(staff12.map((s) => s.id));
  });

  test('1グループでも 429 なら「空きなし」でなく失敗を表示する（以前は空き枠なしに化けていた）', async () => {
    mockSupabase({ booking: { staff_id: null }, staff: staff12 });
    mockFetch(slotsFor([{ slot_start: '10:00:00', slot_end: '11:00:00' }]), { status: 429 });
    render(<BookingChangePage />);
    await pickFirstDate();
    expect(await within(slotPicker()).findByRole('alert')).toHaveTextContent('空き枠を取得できませんでした');
    expect(within(slotPicker()).queryByText('10:00')).not.toBeInTheDocument();
  });

  test('予約したメニューに担当スタッフ（menu_staff）があれば、その人だけで集計する', async () => {
    mockSupabase({
      booking: { staff_id: null, menu_id: 'm1', menu_ids: ['m1', 'm2'] },
      staff: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      menuStaff: [{ menu_id: 'm1', staff_id: 'b' }, { menu_id: 'm1', staff_id: 'c' }, { menu_id: 'm2', staff_id: 'c' }],
    });
    mockFetch(slotsFor([{ slot_start: '11:00:00', slot_end: '12:00:00' }]));
    render(<BookingChangePage />);
    await pickFirstDate();
    const slot = await within(slotPicker()).findByText('11:00');
    expect(menuStaffIn).toHaveBeenCalledWith('menu_staff', 'menu_id', ['m1', 'm2']);
    expect(requestedStaffIds(fetchMock.mock.calls)).toEqual(['c']);
    fireEvent.click(slot);
    expect(screen.getByRole('button', { name: /11:00に変更する/ })).toBeInTheDocument();
  });

  test('menu_ids が無い旧予約は menu_id で担当スタッフを判定し、担当制でないメニューは全員で集計する', async () => {
    mockSupabase({ booking: { staff_id: null, menu_id: 'm9', menu_ids: [] }, staff: [{ id: 'a' }, { id: 'b' }], menuStaff: [] });
    mockFetch(slotsFor([]));
    render(<BookingChangePage />);
    await pickFirstDate();
    expect(await within(slotPicker()).findByText('この日は予約可能な時間帯がありません')).toBeInTheDocument();
    expect(menuStaffIn).toHaveBeenCalledWith('menu_staff', 'menu_id', ['m9']);
    expect(requestedStaffIds(fetchMock.mock.calls)).toEqual(['a', 'b']);
  });

  test('メニューの記録が無い予約は担当判定をせず全員で集計する', async () => {
    mockSupabase({ booking: { staff_id: null, menu_id: null, menu_ids: null }, staff: [{ id: 'a' }] });
    mockFetch(slotsFor([]));
    render(<BookingChangePage />);
    await pickFirstDate();
    await within(slotPicker()).findByText('この日は予約可能な時間帯がありません');
    expect(menuStaffIn).not.toHaveBeenCalled();
    expect(requestedStaffIds(fetchMock.mock.calls)).toEqual(['a']);
  });

  test('担当できるスタッフが1人もいなければ取得せず「空きなし」', async () => {
    mockSupabase({ booking: { staff_id: null }, staff: [] });
    mockFetch(slotsFor([]));
    render(<BookingChangePage />);
    await pickFirstDate();
    expect(await within(slotPicker()).findByText('この日は予約可能な時間帯がありません')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([
    ['スタッフ一覧', { staffError: { message: 'down' } }],
    ['担当スタッフ（menu_staff）', { staff: [{ id: 'a' }], menuStaffError: { message: 'down' } }],
  ])('%sの取得に失敗したら「空きなし」でなく失敗を表示する', async (_label, t) => {
    mockSupabase({ booking: { staff_id: null }, ...t });
    mockFetch(slotsFor([]));
    render(<BookingChangePage />);
    await pickFirstDate();
    expect(await within(slotPicker()).findByRole('alert')).toHaveTextContent('空き枠を取得できませんでした');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
