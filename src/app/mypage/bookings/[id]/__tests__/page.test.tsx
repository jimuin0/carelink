/**
 * @jest-environment jsdom
 *
 * 予約詳細ページの Googleカレンダー連携状態 取得失敗可視化 回帰テスト。
 * 旧実装は .catch(() => {}) で握り潰し、連携済みでも非連携扱いになっていた。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
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
      single: () => Promise.resolve({ data, error: null }),
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
    const obj: Record<string, unknown> = { select: () => obj, eq: () => obj, single: () => Promise.resolve({ data, error: null }) };
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
    const obj: Record<string, unknown> = { select: () => obj, eq: () => obj, single: () => Promise.resolve({ data, error: null }) };
    return obj;
  };
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    from: (t: string) => chain(dataFor[t] ?? null),
  });
}
const STARTED_NOTICE = '開始時刻を過ぎた予約は、オンラインで日時を変更できません。施設へ直接ご連絡ください。';

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
    const obj: Record<string, unknown> = { select: () => obj, eq: () => obj, single: () => Promise.resolve({ data, error: null }) };
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
