import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
jest.mock('react', () => ({ ...jest.requireActual('react'), use: (value: unknown) => value }));
const bookingId = '73000000-0000-4000-8000-000000000001';
const facilityId = '74000000-0000-4000-8000-000000000001';
const menuA = '75000000-0000-4000-8000-000000000001';
const menuB = '75000000-0000-4000-8000-000000000002';
const mockUser = jest.fn();
const mockQueries: { table: string; filters: unknown[][] }[] = [];
const mockResults: Record<string, unknown[]> = {};
function mockFrom(table: string) {
  const query = { table, filters: [] as unknown[][] }; mockQueries.push(query);
  const result = mockResults[table]?.shift() ?? { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ['select','eq','in']) chain[method] = (...args: unknown[]) => { query.filters.push([method,...args]); return chain; };
  chain.single = chain.maybeSingle = () => Promise.resolve(result);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => ({ auth: { getUser: mockUser }, from: mockFrom }) }));
jest.mock('@/components/Toast', () => ({ __esModule: true, default: ({ message,type }: { message:string;type:string }) => <div role="status" data-kind={type}>{message}</div> }));
jest.mock('@/components/admin/AdjustRequestButtons', () => ({ __esModule: true, default: () => null }));
import Detail from '../page';
let fetchMock: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks(); mockQueries.length = 0;
  for (const key of Object.keys(mockResults)) delete mockResults[key];
  mockUser.mockResolvedValue({ data: { user: { id: 'synthetic-user' } }, error: null });
  mockResults.bookings = [{ data: { facility_id: facilityId }, error: null }, { data: {
    id: bookingId, facility_id: facilityId, customer_name: '合成顧客', email: null,
    booking_date: '2026-10-01', start_time: '10:00', end_time: '11:00', status: 'pending',
    total_price: 100, menu_id: menuA, menu_ids: [menuB,menuA], staff_id: null,
  }, error: null }];
  mockResults.facility_members = [{ data: { facility_id: facilityId }, error: null }];
  mockResults.facility_menus = [{ data: [{ id: menuA, name: '施術A' },{ id: menuB,name: '施術B' }], error: null }];
  fetchMock = jest.fn(); global.fetch = fetchMock as typeof fetch;
});
function show() { render(<Detail params={{ id: bookingId } as unknown as Promise<{ id:string }>} />); }
test('locates exact tenant before customer fields; ordered all menus and return navigation stay scoped', async () => {
  show(); await screen.findByText('施術B、施術A');
  expect(mockQueries[1].filters).toContainEqual(['eq','facility_id',facilityId]);
  expect(mockQueries[1].filters).toContainEqual(['in','role',['owner','admin']]);
  expect(mockQueries[2].filters).toContainEqual(['eq','facility_id',facilityId]);
  expect(mockQueries[3].filters).toContainEqual(['eq','facility_id',facilityId]);
  expect(screen.getAllByRole('link').some(link => link.getAttribute('href') === `/admin/bookings?facility_id=${facilityId}`)).toBe(true);
});
test.each([[true, '指名なし（担当: 合成担当）'], [false, '合成担当']])('担当スタッフ欄は指名なしの割り当て(%s)を指名と区別する', async (autoAssigned, label) => {
  const staffId = '76000000-0000-4000-8000-000000000001';
  (mockResults.bookings[1] as { data: Record<string, unknown> }).data.staff_id = staffId;
  (mockResults.bookings[1] as { data: Record<string, unknown> }).data.staff_auto_assigned = autoAssigned;
  mockResults.staff_profiles = [{ data: { name: '合成担当' }, error: null }];
  show(); expect(await screen.findByText(label)).toBeInTheDocument();
});
test('not a member never loads customer fields', async () => {
  mockResults.facility_members = [{ data: null, error: null }]; show(); await screen.findByText('予約が見つかりません');
  expect(mockQueries.filter(q => q.table === 'bookings')).toHaveLength(1);
});
test.each(['auth','target','membership','menus'])('dependency failure %s is not a missing reservation', async source => {
  if (source === 'auth') mockUser.mockResolvedValue({ data: { user: null }, error: { code:'08006' } });
  if (source === 'target') mockResults.bookings[0] = { data: null, error: { code:'08006' } };
  if (source === 'membership') mockResults.facility_members = [{ data: null, error: { code:'08006' } }];
  if (source === 'menus') mockResults.facility_menus = [{ data: null, error: { code:'08006' } }];
  show(); await screen.findByRole('alert'); expect(screen.queryByText('予約が見つかりません')).not.toBeInTheDocument();
});
test.each([null,{}, { success:false }])('HTTP 200 %j never becomes saved status', async data => {
  fetchMock.mockResolvedValue({ ok:true,json:async () => data }); show();
  fireEvent.click(await screen.findByRole('button',{ name:'承認する' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveAttribute('data-kind','error'));
  expect(screen.getByRole('button',{ name:'承認する' })).toBeInTheDocument();
});
test('confirmed status without customer email does not claim delivery', async () => {
  fetchMock.mockResolvedValue({ ok:true,json:async () => ({ success:true }) }); show();
  fireEvent.click(await screen.findByRole('button',{ name:'承認する' }));
  expect(await screen.findByRole('status')).toHaveTextContent('通知の配達完了を保証するものではありません');
  expect(screen.queryByRole('button',{ name:'承認する' })).not.toBeInTheDocument();
});
test.each([null,{}, { success:false,total_price:100 }, { success:true },
  { success:true,total_price:-1 }, { success:true,total_price:'100' }, { success:true,total_price:1.5 }])(
  'invalid checkout response %j never displays saved completion or fabricated zero', async data => {
    (mockResults.bookings[1] as { data:{ status:string } }).data.status = 'confirmed';
    fetchMock.mockResolvedValue({ ok:true,json:async () => data }); show();
    fireEvent.click(await screen.findByRole('button',{ name:'会計する' }));
    fireEvent.click(screen.getByRole('button',{ name:'会計を確定して完了' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveAttribute('data-kind','error'));
    expect(screen.getByRole('button',{ name:'会計を確定して完了' })).toBeInTheDocument();
  });
test('checkout accepts a business-confirmed legitimate zero, not just HTTP 200', async () => {
  (mockResults.bookings[1] as { data:{ status:string } }).data.status = 'confirmed';
  fetchMock.mockResolvedValue({ ok:true,json:async () => ({ success:true,total_price:0 }) }); show();
  fireEvent.click(await screen.findByRole('button',{ name:'会計する' }));
  fireEvent.click(screen.getByRole('button',{ name:'会計を確定して完了' }));
  expect(await screen.findByRole('status')).toHaveTextContent('¥0');
  expect(screen.getByRole('status')).toHaveAttribute('data-kind','success');
});

// ── 来店の結果は予約の開始時刻（JST）を過ぎてから（2026年10月23日） ──
// 以前は翌週の予約でも「完了」を1タップで押せ、会計も確定でき、直す手段は無断キャンセル通知しか無かった。
describe('開始時刻前は「完了」「無断キャンセル」と会計の確定を出さない', () => {
  const START = Date.UTC(2026, 9, 30, 6, 0, 0); // 2026-10-30 15:00 JST
  function booking(status: string) {
    const data = (mockResults.bookings[1] as { data: Record<string, unknown> }).data;
    Object.assign(data, { status, booking_date: '2026-10-30', start_time: '15:00:00', end_time: '16:00:00' });
  }
  afterEach(() => { jest.useRealTimers(); });

  test('開始前の確定予約: 受付・キャンセルだけを出し、完了・無断キャンセル・会計は開始時刻の案内に置き換える', async () => {
    jest.useFakeTimers({ now: START - 60_000 });
    booking('confirmed'); show();
    expect(await screen.findByRole('button', { name: '受付' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '完了' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '無断キャンセル' })).not.toBeInTheDocument();
    expect(screen.getByText('「完了」「無断キャンセル」は、予約の開始時刻（2026年10月30日（金） 15:00）を過ぎると選べます。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '会計する' })).not.toBeInTheDocument();
    expect(screen.getByText('会計は予約の開始時刻（2026年10月30日（金） 15:00）を過ぎると確定できます。')).toBeInTheDocument();
  });

  test('画面を開いたまま開始時刻を迎えると、完了・無断キャンセル・会計が出る', async () => {
    jest.useFakeTimers({ now: START - 10_000 });
    booking('arrived'); show();
    await screen.findByRole('button', { name: 'キャンセル' });
    expect(screen.queryByRole('button', { name: '完了' })).not.toBeInTheDocument();
    await act(async () => { jest.advanceTimersByTime(30_000); });
    expect(screen.getByRole('button', { name: '完了' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '無断キャンセル' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '会計する' })).toBeInTheDocument();
    expect(screen.queryByText(/を過ぎると選べます/)).not.toBeInTheDocument();
  });

  test('開始後の確定予約は従来どおり全ての遷移と会計を出す', async () => {
    jest.useFakeTimers({ now: START });
    booking('confirmed'); show();
    expect(await screen.findByRole('button', { name: '完了' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '無断キャンセル' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '会計する' })).toBeInTheDocument();
    expect(screen.queryByText(/を過ぎると/)).not.toBeInTheDocument();
  });
});

// ── お客様によるキャンセルで通知したキャンセル料（2026年10月23日） ──
// お客様にはキャンセル料の発生と、お支払い方法は施設から直接案内することがメールで届くのに、店舗の画面には何も無かった。
describe('お客様がキャンセルした予約にキャンセル料と受付時刻を出す', () => {
  const context = { policy: { free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'free_window' }, totalPrice: 5000,
    bookingDate: '2026-10-30', startTime: '15:00:00', capturedAt: '2026-10-30T03:00:00Z' };
  function cancelled(feeContext: unknown, email: string | null = 'customer@example.invalid') {
    const data = (mockResults.bookings[1] as { data: Record<string, unknown> }).data;
    Object.assign(data, { status: 'cancelled', cancel_fee_context: feeContext, email });
  }

  test('期限後のキャンセル: 金額・料率と、お客様へ支払い方法を連絡する案内', async () => {
    cancelled(context); show();
    expect(await screen.findByText('お客様によるキャンセル（受付 2026年10月30日 12:00）')).toBeInTheDocument();
    expect(screen.getByText(/キャンセル料/).textContent).toBe('お客様へ、キャンセル料 ¥2,500（施術料金の50%）の発生と、お支払い方法は施設から直接ご案内することをメールでお知らせしています。お支払い方法をお客様へ直接ご連絡ください。');
  });

  // 回帰（レビュー指摘）: メールアドレスの無いお客様にはお客様宛のキャンセル通知が積まれないのに、
  // 「お客様にお知らせしています」と表示し、店舗は連絡を待ち、お客様は料金を知らないままになっていた。
  test.each([null, '', '  '])('メールアドレスの無いお客様 %j: お知らせしていないことと、店舗から直接案内することを示す', async (email) => {
    cancelled(context, email); show();
    await screen.findByText('お客様によるキャンセル（受付 2026年10月30日 12:00）');
    expect(screen.getByText(/キャンセル料/).textContent).toBe('お客様のメールアドレスの登録が無いため、キャンセル料はメールでお知らせしていません。キャンセル料 ¥2,500（施術料金の50%）とお支払い方法を、お客様へ直接ご案内ください。');
    expect(screen.queryByText(/お知らせしています/)).not.toBeInTheDocument();
  });

  test('無料期限内のキャンセル: キャンセル料がかからないことを示す', async () => {
    cancelled({ ...context, capturedAt: '2026-10-20T00:00:00Z' }); show();
    expect(await screen.findByText('キャンセル料はかかりません（お客様へのキャンセル料のお知らせはありません）。')).toBeInTheDocument();
  });

  test.each([null, { policy: 'broken' }])('材料の無い・崩れたキャンセル（店舗側の操作など）では何も出さない %j', async (feeContext) => {
    cancelled(feeContext); show();
    await screen.findByText('施術B、施術A');
    expect(screen.queryByText(/お客様によるキャンセル/)).not.toBeInTheDocument();
  });
});
