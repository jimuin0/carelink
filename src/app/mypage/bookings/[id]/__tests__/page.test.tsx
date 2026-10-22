/**
 * @jest-environment jsdom
 *
 * 予約詳細ページの Googleカレンダー連携状態 取得失敗可視化 回帰テスト。
 * 旧実装は .catch(() => {}) で握り潰し、連携済みでも非連携扱いになっていた。
 */
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import BookingDetailPage from '@/app/mypage/bookings/[id]/page';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

// React 18.3.1 の CJS ビルドは jest 環境で `use` を公開しないため、引数素通しでモック。
// これによりテストでは params を解決済みオブジェクトとして渡せる（Suspense 不要）。
jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return { ...actual, use: (v: unknown) => v };
});
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, refresh: jest.fn() }) }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: jest.fn() }));

const BOOKING = {
  id: 'b1',
  facility_id: 'f1',
  menu_id: null,
  staff_id: null,
  status: 'confirmed',
  booking_date: '2026-06-20',
  start_time: '10:00:00',
  end_time: '11:00:00',
  customer_name: 'テスト太郎',
  total_price: 5000,
  note: null,
};

// テーブルごとに data を返す柔軟なチェーン（select/eq を任意回チェーンでき、single で解決）。
// 予約(.eq×2)・施設(.eq×1)・メニュー/スタッフ など複数のクエリ形状に一様に対応する。
function mockSupabase() {
  const dataFor: Record<string, unknown> = {
    bookings: BOOKING,
    facility_profiles: { slug: 'test-salon', name: 'テスト施設' },
    facility_menus: null,
    staff_profiles: null,
  };
  const chain = (data: unknown): Record<string, unknown> => {
    const obj: Record<string, unknown> = {
      select: () => obj,
      eq: () => obj,
      single: () => Promise.resolve({ data, error: null }), maybeSingle: () => Promise.resolve({ data, error: null }),
    };
    return obj;
  };
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => chain(dataFor[t] ?? null),
  });
}

function mockGcalFetch(ok: boolean, body: object) {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) }),
  ) as unknown as typeof fetch;
}

afterEach(() => jest.clearAllMocks());

function renderPage() {
  // use() をモックしているため、params は解決済みオブジェクトを直接渡す
  return render(
    <BookingDetailPage params={{ id: 'b1' } as unknown as Promise<{ id: string }>} />,
  );
}

test('gcal連携状態の取得失敗 → 握り潰さずエラーを明示する（回帰防止）', async () => {
  mockSupabase();
  mockGcalFetch(false, {});
  renderPage();
  expect(await screen.findByText(/カレンダー連携状態を取得できませんでした/)).toBeInTheDocument();
});

test('gcal取得成功 → エラーを出さず連携同期ボタンを表示（正常系不変）', async () => {
  mockSupabase();
  mockGcalFetch(true, { connected: true, isExpired: false });
  renderPage();
  expect(await screen.findByText(/カレンダーに同期/)).toBeInTheDocument();
  expect(screen.queryByText(/連携状態を取得できませんでした/)).not.toBeInTheDocument();
});

// 監査F5: オンライン事前決済は未実装。canCancel(pending/confirmed)かつ金額ありの予約に
// 「近日公開」表示のみ出す（決済導線は配線しない）。
test('confirmed予約 + 金額あり → オンライン事前決済（近日公開）を表示', async () => {
  mockSupabase();
  mockGcalFetch(true, { connected: true, isExpired: false });
  renderPage();
  expect(await screen.findByText(/オンライン事前決済（近日公開）/)).toBeInTheDocument();
});

test('completed予約（キャンセル不可）→ オンライン事前決済表示なし', async () => {
  const dataFor: Record<string, unknown> = {
    bookings: { ...BOOKING, status: 'completed' },
    facility_profiles: { slug: 'test-salon', name: 'テスト施設' },
    facility_menus: null,
    staff_profiles: null,
  };
  const chain = (data: unknown): Record<string, unknown> => {
    const obj: Record<string, unknown> = { select: () => obj, eq: () => obj, single: () => Promise.resolve({ data, error: null }), maybeSingle: () => Promise.resolve({ data, error: null }) };
    return obj;
  };
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => chain(dataFor[t] ?? null),
  });
  mockGcalFetch(true, { connected: true, isExpired: false });
  renderPage();
  await screen.findByText('テスト施設');
  expect(screen.queryByText(/オンライン事前決済（近日公開）/)).not.toBeInTheDocument();
});

const CALENDAR_ID='fc160004-0000-4000-8000-000000000001';
const CALENDAR_OTHER_ID='fc160004-0000-4000-8000-000000000002';
const CALENDAR_KEY='carelink-calendar-operation:u1:b1:sync';
function calendarResponses(action:(body:any)=>Promise<any>) {
 global.fetch=jest.fn(async(url,options)=>{
  if(url==='/api/google-calendar')return {ok:true,status:200,json:async()=>({connected:true,isExpired:false})};
  return action(JSON.parse(String(options?.body)));
 }) as any;
}
beforeEach(()=>{sessionStorage.clear();jest.restoreAllMocks();jest.spyOn(crypto,'randomUUID').mockReturnValue(CALENDAR_ID);});
test('lost sync response and component reload retain the same operation UUID',async()=>{
 mockSupabase();const seen:any[]=[];calendarResponses(async body=>{seen.push(body);throw new Error('synthetic response lost')});
 const page=renderPage();const {fireEvent}=await import('@testing-library/react');fireEvent.click(await screen.findByText(/カレンダーに同期/));
 await screen.findByText(/同じボタンで結果を再確認/);expect(sessionStorage.getItem(CALENDAR_KEY)).toBe(CALENDAR_ID);page.unmount();
 calendarResponses(async body=>{seen.push(body);return{ok:true,status:200,json:async()=>({ok:true,operationId:body.operationId})}});renderPage();fireEvent.click(await screen.findByText(/カレンダーに同期/));
 await screen.findByText('Googleカレンダーに同期しました');expect(seen.map(x=>x.operationId)).toEqual([CALENDAR_ID,CALENDAR_ID]);expect(sessionStorage.getItem(CALENDAR_KEY)).toBeNull();expect(seen[0]).toEqual({bookingId:'b1',operationId:CALENDAR_ID});
});
test('a same-kind busy operation is adopted for result reconciliation',async()=>{
 mockSupabase();calendarResponses(async()=>({ok:false,status:409,json:async()=>({code:'CALENDAR_BUSY',pendingOperationId:CALENDAR_OTHER_ID})}));renderPage();const{fireEvent}=await import('@testing-library/react');fireEvent.click(await screen.findByText(/カレンダーに同期/));await screen.findByText(/同じボタンで結果を再確認/);expect(sessionStorage.getItem(CALENDAR_KEY)).toBe(CALENDAR_OTHER_ID);
});
test.each([{ok:true,operationId:CALENDAR_OTHER_ID},{ok:false,operationId:CALENDAR_ID},{code:'CALENDAR_BUSY',pendingOperationId:'invalid'}])('unconfirmed response %j does not clear UUID or show success',async data=>{
 mockSupabase();calendarResponses(async()=>({ok:true,status:200,json:async()=>data}));renderPage();const{fireEvent}=await import('@testing-library/react');fireEvent.click(await screen.findByText(/カレンダーに同期/));await screen.findByText(/同じボタンで結果を再確認/);expect(sessionStorage.getItem(CALENDAR_KEY)).toBe(CALENDAR_ID);expect(screen.queryByText('Googleカレンダーに同期しました')).not.toBeInTheDocument();
});
test('unavailable browser storage prevents an unrecoverable request',async()=>{
 mockSupabase();calendarResponses(async()=>{throw new Error('must not dispatch')});jest.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('storage unavailable')});renderPage();const{fireEvent}=await import('@testing-library/react');fireEvent.click(await screen.findByText(/カレンダーに同期/));await screen.findByText(/同じボタンで結果を再確認/);expect((global.fetch as jest.Mock).mock.calls.every(([url])=>url==='/api/google-calendar')).toBe(true);
});

// 開始時刻を過ぎた予約は API・DB とも日時変更を拒否する。押すと必ず失敗する「日時を変更する」を出さず、
// 施設へ連絡する案内に置き換える（回帰防止: 以前は開始後も変更ボタンが出ていた）。
function mockBooking(booking: Record<string, unknown>) {
  const dataFor: Record<string, unknown> = {
    bookings: booking,
    facility_profiles: { slug: 'test-salon', name: 'テスト施設' },
    facility_menus: null,
    staff_profiles: null,
  };
  const chain = (data: unknown): Record<string, unknown> => {
    const obj: Record<string, unknown> = { select: () => obj, eq: () => obj, single: () => Promise.resolve({ data, error: null }), maybeSingle: () => Promise.resolve({ data, error: null }) };
    return obj;
  };
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => chain(dataFor[t] ?? null),
  });
}
const STARTED_NOTICE = '開始時刻を過ぎた予約は、オンラインで日時の変更やキャンセルができません。店舗へ直接ご連絡ください。';

test.each(['pending', 'confirmed'])('開始前の %s 予約 → 日時を変更するボタンを表示', async (status) => {
  mockBooking({ ...BOOKING, status, booking_date: '2099-06-20' });
  mockGcalFetch(true, { connected: false });
  renderPage();
  expect(await screen.findByRole('button', { name: '日時を変更する' })).toBeInTheDocument();
  expect(screen.queryByText(STARTED_NOTICE)).not.toBeInTheDocument();
});

test('開始時刻を過ぎた confirmed 予約 → 変更ボタンを出さず、施設への連絡を案内する', async () => {
  mockBooking({ ...BOOKING, booking_date: '2020-06-20' });
  mockGcalFetch(true, { connected: false });
  renderPage();
  expect(await screen.findByText(STARTED_NOTICE)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '日時を変更する' })).not.toBeInTheDocument();
});

test('来店中（arrived）の予約 → 変更ボタンも開始後の案内も出さない（API が変更を受け付けない状態）', async () => {
  mockBooking({ ...BOOKING, status: 'arrived', booking_date: '2099-06-20' });
  mockGcalFetch(true, { connected: false });
  renderPage();
  await screen.findByText('テスト施設');
  expect(screen.queryByRole('button', { name: '日時を変更する' })).not.toBeInTheDocument();
  expect(screen.queryByText(STARTED_NOTICE)).not.toBeInTheDocument();
});

// おまかせ（指名なし）の予約も予約 RPC が担当者を割り当てて staff_id に保存する。staff_auto_assigned で
// 指名と区別しないと、再予約がその担当者の「指名」になり指名料がかかる（回帰防止）。
function mockBookingWithStaff(booking: Record<string, unknown>) {
  const dataFor: Record<string, unknown> = {
    bookings: booking,
    facility_profiles: { slug: 'test-salon', name: 'テスト施設' },
    facility_menus: { name: 'カット' },
    staff_profiles: { name: '担当A' },
  };
  const chain = (data: unknown): Record<string, unknown> => {
    const obj: Record<string, unknown> = { select: () => obj, eq: () => obj, single: () => Promise.resolve({ data, error: null }), maybeSingle: () => Promise.resolve({ data, error: null }) };
    return obj;
  };
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => chain(dataFor[t] ?? null),
  });
}

test('指名なしで割り当てられた予約の再予約 → 担当者を指名として引き継がない', async () => {
  mockBookingWithStaff({ ...BOOKING, status: 'completed', menu_id: 'm1', staff_id: 's1', staff_auto_assigned: true });
  mockGcalFetch(true, { connected: false });
  renderPage();
  const { fireEvent } = await import('@testing-library/react');
  fireEvent.click(await screen.findByRole('button', { name: 'この店舗をもう一度予約する' }));
  expect(mockPush).toHaveBeenCalledWith('/facility/test-salon/booking?menu_id=m1');
  expect(screen.getByText('指名なし（担当: 担当A）')).toBeInTheDocument();
});

test('指名した予約の再予約 → 同じスタッフを引き継ぐ（従来どおり）', async () => {
  mockBookingWithStaff({ ...BOOKING, status: 'completed', menu_id: 'm1', staff_id: 's1', staff_auto_assigned: false });
  mockGcalFetch(true, { connected: false });
  renderPage();
  const { fireEvent } = await import('@testing-library/react');
  fireEvent.click(await screen.findByRole('button', { name: 'この店舗をもう一度予約する' }));
  expect(mockPush).toHaveBeenCalledWith('/facility/test-salon/booking?menu_id=m1&staff_id=s1');
  expect(screen.getByText('担当A')).toBeInTheDocument();
});

// 店舗が「ネットでのキャンセル不可（店舗へ直接ご連絡）」を選んでいる予約では、押しても API が必ず断る
// キャンセルボタンの代わりに、店舗への連絡を案内する（2026年10月23日）。
const ONLINE_CANCEL_DISABLED = 'この店舗ではネットからのキャンセルをお受けしていません。キャンセルをご希望の場合は、店舗へ直接ご連絡ください。';
function mockBookingWithPolicy(policy: unknown, policyError: unknown = null) {
  const dataFor: Record<string, unknown> = {
    bookings: { ...BOOKING, booking_date: '2099-06-20' },
    facility_profiles: { slug: 'test-salon', name: 'テスト施設' },
  };
  const chain = (table: string): Record<string, unknown> => {
    const data = table === 'facility_cancel_policies' ? policy : dataFor[table] ?? null;
    const error = table === 'facility_cancel_policies' ? policyError : null;
    const obj: Record<string, unknown> = {
      select: () => obj, eq: () => obj,
      single: () => Promise.resolve({ data, error }), maybeSingle: () => Promise.resolve({ data, error }),
    };
    return obj;
  };
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => chain(t),
  });
}

test('ネットでのキャンセル不可の店舗 → キャンセルボタンを出さず、店舗への連絡を案内する', async () => {
  mockBookingWithPolicy({ free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'no_online' });
  mockGcalFetch(true, { connected: false });
  renderPage();
  expect(await screen.findByText(ONLINE_CANCEL_DISABLED)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'この予約をキャンセル' })).not.toBeInTheDocument();
  // 日時の変更はキャンセルではないので、これまでどおり出す。
  expect(screen.getByRole('button', { name: '日時を変更する' })).toBeInTheDocument();
});

test.each([
  ['ポリシー未設定', null, null],
  ['期限なし（常にキャンセル料）', { free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'always_fee' }, null],
  ['ポリシーを読めなかった（最終判定は API）', null, { message: 'synthetic' }],
])('%s → キャンセルボタンを表示', async (_label, policy, policyError) => {
  mockBookingWithPolicy(policy, policyError);
  mockGcalFetch(true, { connected: false });
  renderPage();
  expect(await screen.findByRole('button', { name: 'この予約をキャンセル' })).toBeInTheDocument();
  expect(screen.queryByText(ONLINE_CANCEL_DISABLED)).not.toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// 「店舗へ直接ご連絡ください」には連絡手段を添える／開始後はキャンセルボタンを出さない（2026年10月23日）。
// 以前は案内の文言だけで電話番号も店舗ページへのリンクも無く、開始後も押すと必ず失敗するキャンセルボタンが出ていた。
// ---------------------------------------------------------------------------
type Fixture = { booking: Record<string, unknown>; facility?: unknown; policy?: unknown; policyError?: unknown };
function mockDetail({ booking, facility = { slug: 'test-salon', name: 'テスト施設', phone: '03-1234-5678' }, policy = null, policyError = null }: Fixture) {
  const chain = (table: string): Record<string, unknown> => {
    const data = table === 'bookings' ? booking
      : table === 'facility_profiles' ? facility
      : table === 'facility_cancel_policies' ? policy : null;
    const error = table === 'facility_cancel_policies' ? policyError : null;
    const obj: Record<string, unknown> = {
      select: () => obj, eq: () => obj,
      single: () => Promise.resolve({ data, error }), maybeSingle: () => Promise.resolve({ data, error }),
    };
    return obj;
  };
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => chain(t),
  });
}
const CANCEL_BUTTON = { name: 'この予約をキャンセル' };

test.each(['confirmed', 'pending', 'arrived'])('開始時刻を過ぎた %s 予約 → キャンセルボタンを出さず、電話と店舗ページを添えて連絡を案内する', async (status) => {
  mockDetail({ booking: { ...BOOKING, status, booking_date: '2020-06-20' }, policy: { free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'free_window' } });
  mockGcalFetch(true, { connected: false });
  renderPage();
  expect(await screen.findByText(STARTED_NOTICE)).toBeInTheDocument();
  expect(screen.queryByRole('button', CANCEL_BUTTON)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '店舗に電話する（03-1234-5678）' })).toHaveAttribute('href', 'tel:03-1234-5678');
  expect(screen.getByRole('link', { name: '店舗ページを見る' })).toHaveAttribute('href', '/facility/test-salon');
});

test('ネットでのキャンセル不可の店舗 → 案内に電話と店舗ページを添える', async () => {
  mockDetail({ booking: { ...BOOKING, booking_date: '2099-06-20' }, policy: { free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'no_online' } });
  mockGcalFetch(true, { connected: false });
  renderPage();
  expect(await screen.findByText(ONLINE_CANCEL_DISABLED)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '店舗に電話する（03-1234-5678）' })).toHaveAttribute('href', 'tel:03-1234-5678');
  expect(screen.getByRole('link', { name: '店舗ページを見る' })).toHaveAttribute('href', '/facility/test-salon');
});

test('電話番号が電話リンクにできない形なら tel: を出さず、店舗ページへのリンクだけ出す（店舗ページと同じ判定）', async () => {
  mockDetail({
    booking: { ...BOOKING, booking_date: '2099-06-20' },
    facility: { slug: 'test-salon', name: 'テスト施設', phone: 'javascript:alert(1)' },
    policy: { free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'no_online' },
  });
  mockGcalFetch(true, { connected: false });
  renderPage();
  expect(await screen.findByText(ONLINE_CANCEL_DISABLED)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /店舗に電話する/ })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '店舗ページを見る' })).toBeInTheDocument();
});

test('開始前でネットからキャンセルできる店舗 → 連絡の案内は出さず、キャンセルボタンを出す', async () => {
  mockDetail({ booking: { ...BOOKING, booking_date: '2099-06-20' } });
  mockGcalFetch(true, { connected: false });
  renderPage();
  expect(await screen.findByRole('button', CANCEL_BUTTON)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: '店舗ページを見る' })).not.toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// キャンセル確認にキャンセル料の見込みを出し、キャンセル後は API が返した確定額を出す（2026年10月23日）。
// 以前は「キャンセル料が発生する場合があります」の固定文言で、API の cancelFee は捨てていた。
// ---------------------------------------------------------------------------
const START_MS = Date.UTC(2099, 5, 20, 1, 0, 0); // 2099-06-20 10:00 JST
function cancelFetch(cancelBody: unknown, ok = true) {
  global.fetch = jest.fn(async (url: string) => {
    if (url === '/api/google-calendar') return { ok: true, status: 200, json: async () => ({ connected: false }) };
    return { ok, status: ok ? 200 : 400, json: async () => cancelBody };
  }) as unknown as typeof fetch;
}
const cancelCalls = () => (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes('/cancel'));

test('常にキャンセル料の店舗 → 確認に金額と料率を出し、キャンセル後は API の確定額を出す', async () => {
  const { fireEvent } = await import('@testing-library/react');
  mockDetail({ booking: { ...BOOKING, booking_date: '2099-06-20' }, policy: { free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'always_fee' } });
  cancelFetch({ success: true, cancelFee: 2500 });
  renderPage();
  const cancelButton = await screen.findByRole('button', CANCEL_BUTTON);
  // 確定額のお知らせ先は、キャンセル前から空で置いてあるライブリージョン（後から文字を入れて読み上げさせる）。
  const receiptRegion = screen.getByRole('status');
  expect(receiptRegion).toBeEmptyDOMElement();
  fireEvent.click(cancelButton);
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('この予約をキャンセルしますか？いまキャンセルすると、キャンセル料 ¥2,500（施術料金の50%）がかかります。');
  expect(dialog).not.toHaveTextContent('発生する場合があります');
  // 開いたときにフォーカスはボタンへ移るので、金額はダイアログの説明として読み上げられる必要がある。
  expect(dialog).toHaveAccessibleDescription('この予約をキャンセルしますか？いまキャンセルすると、キャンセル料 ¥2,500（施術料金の50%）がかかります。お支払い方法は店舗からご案内します。');
  fireEvent.click(screen.getByRole('button', { name: 'キャンセルする' }));
  expect(await screen.findByText('予約をキャンセルしました。キャンセル料 ¥2,500 が発生します。お支払い方法は店舗からご案内します。')).toBeInTheDocument();
  expect(receiptRegion).toBeInTheDocument();
  expect(receiptRegion).toHaveTextContent('予約をキャンセルしました。キャンセル料 ¥2,500 が発生します。');
  expect(cancelCalls()).toHaveLength(1);
});

test('無料期限内 → 確認ではっきり無料と期限を出し、キャンセル後も無料と出す', async () => {
  const { fireEvent } = await import('@testing-library/react');
  mockDetail({ booking: { ...BOOKING, booking_date: '2099-06-20' }, policy: { free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'free_window' } });
  cancelFetch({ success: true, cancelFee: 0 });
  renderPage();
  fireEvent.click(await screen.findByRole('button', CANCEL_BUTTON));
  expect(await screen.findByRole('dialog')).toHaveTextContent('いまキャンセルする場合、キャンセル料はかかりません（予約日時の24時間前まで無料）。');
  fireEvent.click(screen.getByRole('button', { name: 'キャンセルする' }));
  expect(await screen.findByText('予約をキャンセルしました。キャンセル料はかかりません。')).toBeInTheDocument();
});

test('ポリシーを読めなかった → 金額を推測せず従来の案内のまま。応答に金額が無ければ確定額も出さない', async () => {
  const { fireEvent } = await import('@testing-library/react');
  mockDetail({ booking: { ...BOOKING, booking_date: '2099-06-20' }, policy: null, policyError: { message: 'synthetic' } });
  cancelFetch({ success: true });
  renderPage();
  fireEvent.click(await screen.findByRole('button', CANCEL_BUTTON));
  expect(await screen.findByRole('dialog')).toHaveTextContent('この予約をキャンセルしますか？キャンセルポリシーによりキャンセル料が発生する場合があります。');
  fireEvent.click(screen.getByRole('button', { name: 'キャンセルする' }));
  expect(await screen.findByText('予約をキャンセルしました')).toBeInTheDocument();
  expect(screen.queryByText(/予約をキャンセルしました。/)).not.toBeInTheDocument();
});

test('確認を開いたあとで無料期限を過ぎた → 取り消さずに新しい金額を見せ直し、もう一度押して初めて取り消す', async () => {
  const { fireEvent } = await import('@testing-library/react');
  const now = jest.spyOn(Date, 'now').mockReturnValue(START_MS - 25 * 3_600_000);
  mockDetail({ booking: { ...BOOKING, booking_date: '2099-06-20' }, policy: { free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'free_window' } });
  cancelFetch({ success: true, cancelFee: 2500 });
  renderPage();
  fireEvent.click(await screen.findByRole('button', CANCEL_BUTTON));
  const openedDialog = await screen.findByRole('dialog');
  expect(openedDialog).toHaveTextContent('キャンセル料はかかりません（予約日時の24時間前まで無料）');
  const noticeBefore = within(openedDialog).getByRole('status');
  expect(noticeBefore).toBeEmptyDOMElement();
  now.mockReturnValue(START_MS - 23 * 3_600_000);
  fireEvent.click(screen.getByRole('button', { name: 'キャンセルする' }));
  const dialog = await screen.findByRole('dialog');
  // 見込みが変わったことは、開いた時点から在るライブリージョンに書き込んで読み上げさせる
  // （本文の書き換えだけでは読み上げられず、押しても何も起きないように聞こえる）。
  const notice = within(dialog).getByRole('status');
  expect(noticeBefore).toBe(notice);
  expect(notice).toHaveTextContent('キャンセル料の条件が変わりました。いまキャンセルすると、キャンセル料 ¥2,500（施術料金の50%）がかかります。お支払い方法は店舗からご案内します。内容をご確認のうえ、もう一度「キャンセルする」を押してください。');
  expect(dialog).toHaveTextContent('この予約をキャンセルしますか？');
  expect(dialog).not.toHaveTextContent('24時間前まで無料');
  expect(dialog).toHaveAccessibleDescription(/キャンセル料の条件が変わりました。.*¥2,500/);
  expect(cancelCalls()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'キャンセルする' }));
  expect(await screen.findByText('予約をキャンセルしました。キャンセル料 ¥2,500 が発生します。お支払い方法は店舗からご案内します。')).toBeInTheDocument();
  expect(cancelCalls()).toHaveLength(1);
});
