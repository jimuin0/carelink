import * as React from 'react';
import EditStaff from '../[id]/edit/page';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import NewStaff from '../new/page';
import Schedule from '../[id]/schedule/page';
const mockPush = jest.fn(); const mockRouter = { push: mockPush }; const mockSelection = jest.fn(); const mockGetUser = jest.fn(); const mockFrom = jest.fn();
const facility = '71000000-0000-4000-8000-000000000002';
const mockFetch = jest.fn();
let mockRequested = facility;
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter, useParams: () => ({ id: 'synthetic-staff' }), useSearchParams: () => new URLSearchParams(`facility_id=${mockRequested}`) }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => ({ auth: { getUser: mockGetUser }, from: mockFrom }) }));
jest.mock('@/lib/admin-facility-selection', () => ({ loadAdminFacilitySelection: (...args: unknown[]) => mockSelection(...args) }));
jest.mock('@/components/admin/FacilitySelector', () => ({ __esModule: true, default: () => <p>店舗選択</p> }));
const mockGuard = jest.fn();
jest.mock('@/hooks/useUnsavedGuard', () => ({ useUnsavedGuard: (dirty: boolean) => mockGuard(dirty) }));
beforeEach(() => {
  jest.clearAllMocks(); mockFetch.mockReset(); sessionStorage.clear(); mockRequested = facility; global.fetch = mockFetch;
  mockGetUser.mockResolvedValue({ data: { user: { id: 'synthetic-owner' } }, error: null });
  mockSelection.mockResolvedValue({ choices: [{ id: facility, name: '合成B' }], selectedId: facility });
});
test('new staff posts to selected B and returns to B', async () => {
  mockFetch.mockResolvedValue({ ok: true }); render(<NewStaff />);
  fireEvent.change(await screen.findByLabelText(/名前/), { target: { value: '合成スタッフ' } });
  fireEvent.click(screen.getByText('スタッフを追加'));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(`/api/admin/staff?facility_id=${facility}`, expect.objectContaining({ method: 'POST' })));
  expect(mockSelection).toHaveBeenCalledWith(expect.anything(), 'synthetic-owner', facility);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/admin/staff?facility_id=${facility}`));
});
test('new staff network failure retains form and reports failure', async () => {
  mockFetch.mockRejectedValue(new Error('synthetic failure')); render(<NewStaff />);
  fireEvent.change(await screen.findByLabelText(/名前/), { target: { value: '合成スタッフ' } }); fireEvent.click(screen.getByText('スタッフを追加'));
  await screen.findByText('通信エラーが発生しました'); expect(mockPush).not.toHaveBeenCalled(); expect((screen.getByLabelText(/名前/) as HTMLInputElement).value).toBe('合成スタッフ');
});
test('auth unavailable and membership failure never expose write form', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: { status: 503 } }); const mounted = render(<NewStaff />);
  await screen.findByText(/利用権限を再確認/); expect(mockSelection).not.toHaveBeenCalled(); expect(screen.queryByText('スタッフを追加')).toBeNull(); mounted.unmount();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null }); mockSelection.mockRejectedValue(new Error('selection unavailable')); render(<NewStaff />);
  await screen.findByText(/店舗情報の取得に失敗/); expect(mockFetch).not.toHaveBeenCalled(); expect(screen.queryByText('スタッフを追加')).toBeNull();
});
test('schedule rejects staff from another tenant before loading shifts and back retains B', async () => {
  const eq = jest.fn(); const chain = { select: () => chain, eq: (...args: unknown[]) => { eq(...args); return chain; }, single: async () => ({ data: null, error: { code: 'PGRST116' } }) };
  mockFrom.mockReturnValue(chain); render(<Schedule />);
  await screen.findByText(/読み込みに失敗/); expect(eq).toHaveBeenCalledWith('facility_id', facility);
  expect(mockFrom).toHaveBeenCalledTimes(1); expect(mockFrom).toHaveBeenCalledWith('staff_profiles');
  expect(screen.queryByText('スケジュールを保存')).toBeNull(); fireEvent.click(screen.getByText('← 戻る'));
  expect(mockPush).toHaveBeenCalledWith(`/admin/staff?facility_id=${facility}`); expect(mockFetch).not.toHaveBeenCalled();
});

test('changing facility remounts the new form and old selection cannot restore it', async () => {
  const mounted = render(<NewStaff />);
  fireEvent.change(await screen.findByLabelText(/名前/), { target: { value: '店舗Bの未保存スタッフ' } });
  const nextFacility = '71000000-0000-4000-8000-000000000003';
  let release: (value: unknown) => void = () => undefined;
  mockSelection.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  mockRequested = nextFacility; mounted.rerender(<NewStaff />);
  await waitFor(() => expect(mockSelection).toHaveBeenCalledWith(expect.anything(), 'synthetic-owner', nextFacility));
  expect(screen.queryByLabelText(/名前/)).toBeNull();
  release({ choices: [{ id: nextFacility, name: '合成C' }], selectedId: nextFacility });
  expect((await screen.findByLabelText(/名前/ ) as HTMLInputElement).value).toBe('');
  expect(mockFetch).not.toHaveBeenCalled();
});
test('schedule DELETE network failure retains override and asks to recheck result', async () => {
  mockFrom.mockImplementation((table: string) => {
    const result = { data: table === 'staff_profiles' ? { name: '合成スタッフ' } : table === 'staff_schedules' ? [] : [{ id: 'synthetic-override', date: '2026-12-01', is_holiday: true, start_time: null, end_time: null }], error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'gte', 'order']) chain[method] = () => chain;
    chain.single = async () => result; chain.then = (resolve: (value: unknown) => unknown) => resolve(result); return chain;
  });
  mockFetch.mockRejectedValue(new Error('synthetic network outage')); render(<Schedule />);
  fireEvent.click(await screen.findByText('削除'));
  fireEvent.click(await screen.findByText('削除する'));
  await screen.findByText('通信エラーが発生しました。削除結果を再読み込みして確認してください');
  expect(screen.getAllByText('休み', { selector: 'span' })).toHaveLength(8);
  expect(mockFetch).toHaveBeenCalledWith(`/api/admin/staff/synthetic-staff/schedule?facility_id=${facility}`, expect.objectContaining({ method: 'DELETE' }));
});

test('edit rejects another tenant staff before menu reads and never exposes PATCH', async () => {
  const eq = jest.fn();
  const chain = { select: () => chain, eq: (...args: unknown[]) => { eq(...args); return chain; }, single: async () => ({ data: null, error: { code: 'PGRST116' } }) };
  mockFrom.mockReturnValue(chain);
  const params = Promise.resolve({ id: 'synthetic-staff' });
  await act(async () => { render(<React.Suspense fallback={<p>準備中</p>}><EditStaff params={params} /></React.Suspense>); });
    await screen.findByText('スタッフ情報の読み込みに失敗しました');
    expect(eq).toHaveBeenCalledWith('facility_id', facility);
    expect(mockFrom).toHaveBeenCalledTimes(1); expect(mockFrom).toHaveBeenCalledWith('staff_profiles');
    expect(screen.queryByLabelText(/名前/)).toBeNull(); expect(mockFetch).not.toHaveBeenCalled();
});
test('completed POST from a departed store cannot navigate the new store form away', async () => {
  let releasePost: (value: unknown) => void = () => undefined;
  mockFetch.mockImplementation(() => new Promise(resolve => { releasePost = resolve; }));
  const mounted = render(<NewStaff />);
  fireEvent.change(await screen.findByLabelText(/名前/), { target: { value: '店舗Bのスタッフ' } });
  fireEvent.click(screen.getByText('スタッフを追加')); await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  mockRequested = '71000000-0000-4000-8000-000000000003';
  mockSelection.mockResolvedValue({ choices: [{ id: mockRequested, name: '合成C' }], selectedId: mockRequested });
  mounted.rerender(<NewStaff />); await screen.findByLabelText(/名前/);
  await act(async () => { releasePost({ ok: true }); });
  expect(mockPush).not.toHaveBeenCalled(); expect((screen.getByLabelText(/名前/) as HTMLInputElement).value).toBe('');
});

test('lost creation response retries identical UUID and payload while freezing edits', async () => {
  mockFetch.mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce({ ok: true }); render(<NewStaff />);
  fireEvent.change(await screen.findByLabelText(/名前/), { target: { value: '合成スタッフ' } }); fireEvent.click(screen.getByText('スタッフを追加'));
  await screen.findByText('通信エラーが発生しました'); expect((screen.getByLabelText(/名前/).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
  const first = mockFetch.mock.calls[0][1].body; fireEvent.click(screen.getByText('スタッフを追加'));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2)); expect(mockFetch.mock.calls[1][1].body).toBe(first);
  expect(JSON.parse(first).operation_id).toMatch(/^[a-f0-9-]{36}$/);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/admin/staff?facility_id=${facility}`));
});
test('reloaded creation resolves pending receipt before displaying a new write form', async () => {
  const key = `carelink-staff-operation:synthetic-owner:${facility}:new`;
  sessionStorage.setItem(key, '66000000-0000-4000-8000-000000000001');
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ state: 'saved' }) }); render(<NewStaff />);
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/admin/staff?facility_id=${facility}`));
  expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('kind=create'), { cache: 'no-store' });
  expect(screen.queryByText('スタッフを追加')).toBeNull(); expect(sessionStorage.getItem(key)).toBeNull();
});

test('a rate-limited retry resolves an earlier committed creation before clearing its UUID', async () => {
  mockFetch.mockRejectedValueOnce(new Error('response lost'))
    .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ error: 'rate limited' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ state: 'saved' }) });
  render(<NewStaff />); fireEvent.change(await screen.findByLabelText(/名前/), { target: { value: '合成スタッフ' } });
  fireEvent.click(screen.getByText('スタッフを追加')); await screen.findByText('通信エラーが発生しました');
  fireEvent.click(screen.getByText('スタッフを追加'));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/admin/staff?facility_id=${facility}`));
  expect(mockFetch).toHaveBeenCalledTimes(3); expect(mockFetch.mock.calls[1][1].body).toBe(mockFetch.mock.calls[0][1].body);
  expect(mockFetch.mock.calls[2][0]).toContain('kind=create'); expect(mockFetch.mock.calls[2][1]).toEqual({ cache: 'no-store' });
});

/** 週間スケジュール画面の読み取り。テーブルごとの結果を差し替えられる。 */
function scheduleTables(results: { schedules?: unknown[]; businessHours?: unknown; facilityError?: unknown; overrides?: unknown[] } = {}) {
  mockFrom.mockImplementation((table: string) => {
    const result = table === 'staff_profiles' ? { data: { name: '合成スタッフ' }, error: null }
      : table === 'staff_schedules' ? { data: results.schedules ?? [], error: null }
      : table === 'facility_profiles' ? { data: results.facilityError ? null : { business_hours: results.businessHours ?? null }, error: results.facilityError ?? null }
      : table === 'schedule_overrides' ? { data: results.overrides ?? [], error: null }
      : { data: [], error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ['select','eq','gte','order']) chain[method] = () => chain;
    chain.single = async () => result; chain.then = (resolve: (value: unknown) => unknown) => resolve(result); return chain;
  });
}
const SHOP_HOURS = {
  mon: null, tue: { open: '10:00', close: '20:00' }, wed: { open: '10:00', close: '20:00' }, thu: { open: '10:00', close: '20:00' },
  fri: { open: '10:00', close: '21:00' }, sat: { open: '09:30', close: '18:00' }, sun: null,
};
const dayBox = (day: string) => screen.getByRole('checkbox', { name: day, exact: true }) as HTMLInputElement;

const ZERO_DAYS_MESSAGE = '勤務する曜日を1日以上選んでください。勤務日が無いと、このスタッフにはネット予約が入りません（特別な日だけ勤務する場合は、下の「特別日設定」で勤務日を追加してください）';

test('empty stored weekly schedule without confirmed shop hours displays all days off and refuses to save zero working days', async () => {
  scheduleTables();
  mockFetch.mockResolvedValue({ ok: true }); render(<Schedule />);
  await screen.findByText('この勤務時間で保存する');
  expect(screen.getByText('このスタッフは勤務時間が未登録のため、まだネット予約を受けられません。')).toBeTruthy();
  expect(screen.getByRole('link', { name: '施設設定で営業時間を保存する' }).getAttribute('href')).toBe(`/admin/settings?facility_id=${facility}`);
  for (const day of ['日','月','火','水','木','金','土']) expect(dayBox(day).checked).toBe(false);
  // 何も入っていない下書きは失うものが無いので、離れる確認は出さない
  expect(mockGuard).toHaveBeenLastCalledWith(false);
  // 勤務日0日の保存は「成功」に見えて、このスタッフに予約が1件も入らない。理由を示して止める。
  fireEvent.click(screen.getByText('この勤務時間で保存する'));
  await screen.findByText(ZERO_DAYS_MESSAGE);
  expect(mockFetch).not.toHaveBeenCalled();
});

test('勤務日を外して0日にした保存も止める', async () => {
  scheduleTables({ schedules: [{ day_of_week: 1, start_time: '12:00:00', end_time: '18:00:00' }] });
  render(<Schedule />);
  await screen.findByText('スケジュールを保存');
  fireEvent.click(dayBox('月'));
  fireEvent.click(screen.getByText('スケジュールを保存'));
  await screen.findByText(ZERO_DAYS_MESSAGE);
  expect(mockFetch).not.toHaveBeenCalled();
});

// E8: 追加しただけのスタッフには勤務が無い。店舗の営業時間を下書きとして見せ、保存したときだけ登録する。
test('a staff member without a schedule gets this shop\'s confirmed hours as an unsaved suggestion, saved only on confirm', async () => {
  scheduleTables({ businessHours: SHOP_HOURS });
  mockFetch.mockResolvedValue({ ok: true }); render(<Schedule />);
  await screen.findByText('この勤務時間で保存する');
  expect(screen.getByText(/店舗の営業時間をもとにした下書きで、まだ保存されていません/)).toBeTruthy();
  expect(screen.getByText('このスタッフは勤務時間が未登録のため、まだネット予約を受けられません。')).toBeTruthy();
  // サロンボードの「指名なし」の電話予約も勤務時間のある人にしか割り当てない（20261023130100）
  expect(screen.getByText('予約表の「指名なし」の予約も、勤務時間を保存したスタッフにだけ割り当てられます。')).toBeTruthy();
  expect(['日','月','火','水','木','金','土'].map(day => dayBox(day).checked)).toEqual([false, false, true, true, true, true, true]);
  expect(screen.getAllByDisplayValue('09:30')).toHaveLength(1);
  expect(screen.queryByDisplayValue('19:00')).toBeNull(); // 毎日 09:00〜19:00 を持ち込まない
  // 表示しただけでは何も保存しない
  expect(mockFetch).not.toHaveBeenCalled();
  // 下書きは未保存。そのまま離れると勤務時間が登録されないので、離れる前に確認させる
  expect(mockGuard).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByText('この勤務時間で保存する'));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(`/api/admin/staff/synthetic-staff/schedule?facility_id=${facility}`, expect.objectContaining({ method: 'PUT' })));
  expect(JSON.parse(mockFetch.mock.calls[0][1].body).schedules).toEqual([
    { day_of_week: 2, start_time: '10:00', end_time: '20:00' }, { day_of_week: 3, start_time: '10:00', end_time: '20:00' },
    { day_of_week: 4, start_time: '10:00', end_time: '20:00' }, { day_of_week: 5, start_time: '10:00', end_time: '21:00' },
    { day_of_week: 6, start_time: '09:30', end_time: '18:00' },
  ]);
});

// 特別日（時間変更）だけで勤務するスタッフは、その日に予約を受けられる（予約枠・検索カードと同じ規則）。
// 「未登録」と言ったり、店舗の営業日に下書きのチェックを入れたりしない。
describe('特別日だけ勤務するスタッフ', () => {
  beforeEach(() => {
    // 2026-10-22T15:30Z は日本時間で 10月23日 00:30（UTC の日付ではまだ 22日）。
    jest.useFakeTimers({ now: new Date('2026-10-22T15:30:00Z'), doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'clearImmediate'] });
  });
  afterEach(() => jest.useRealTimers());

  test('今後の勤務する特別日があれば、未登録の警告も下書きも出さず、保存済みのとおり週間は休みで見せる', async () => {
    scheduleTables({ businessHours: SHOP_HOURS, overrides: [
      { id: 'ov-work', date: '2026-10-23', is_holiday: false, start_time: '10:00:00', end_time: '15:00:00' },
    ] });
    render(<Schedule />);
    await screen.findByText('スケジュールを保存');
    expect(screen.queryByText('このスタッフは勤務時間が未登録のため、まだネット予約を受けられません。')).toBeNull();
    expect(screen.getByText(/週間の勤務日は登録されていません。下の「特別日設定」で勤務時間を入れた日だけ、ネット予約を受けられます。/)).toBeTruthy();
    for (const day of ['日','月','火','水','木','金','土']) expect(dayBox(day).checked).toBe(false);
    // 特別日の日付は日本時間の今日から選べる（UTC の日付ではまだ前日）
    expect(document.querySelector('input[type="date"]')?.getAttribute('min')).toBe('2026-10-23');
    // 曜日にチェックを入れたときの初期時刻は店舗の営業時間（09:00〜19:00 を持ち込まない）
    fireEvent.click(dayBox('土'));
    expect(screen.getByDisplayValue('09:30')).toBeTruthy();
    expect(screen.queryByDisplayValue('19:00')).toBeNull();
  });

  test('特別日に勤務するなら、週間の勤務日が0日でも保存は止めない', async () => {
    scheduleTables({ businessHours: SHOP_HOURS, overrides: [
      { id: 'ov-work', date: '2026-10-23', is_holiday: false, start_time: '10:00:00', end_time: '15:00:00' },
    ] });
    mockFetch.mockResolvedValue({ ok: true });
    render(<Schedule />);
    fireEvent.click(await screen.findByText('スケジュールを保存'));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/schedule?'), expect.objectContaining({ method: 'PUT' })));
    expect(screen.queryByText(ZERO_DAYS_MESSAGE)).toBeNull();
  });

  test.each([
    ['休みの特別日', { id: 'ov-off', date: '2026-10-30', is_holiday: true, start_time: null, end_time: null }],
    ['時刻の無い特別日', { id: 'ov-blank', date: '2026-10-30', is_holiday: null, start_time: null, end_time: null }],
    ['日本時間では昨日の特別日', { id: 'ov-past', date: '2026-10-22', is_holiday: false, start_time: '10:00:00', end_time: '15:00:00' }],
  ])('%sしか無ければ勤務時間は無いものとして、下書きと未登録の警告を出す', async (_label, override) => {
    scheduleTables({ businessHours: SHOP_HOURS, overrides: [override] });
    render(<Schedule />);
    await screen.findByText('この勤務時間で保存する');
    expect(screen.getByText('このスタッフは勤務時間が未登録のため、まだネット予約を受けられません。')).toBeTruthy();
    expect(screen.queryByText(/週間の勤務日は登録されていません/)).toBeNull();
    expect(dayBox('火').checked).toBe(true);
  });
});

test('a saved schedule is shown as saved, without the suggestion notice or the shop-hours read', async () => {
  scheduleTables({ schedules: [{ day_of_week: 1, start_time: '12:00:00', end_time: '18:00:00' }], businessHours: SHOP_HOURS });
  render(<Schedule />);
  await screen.findByText('スケジュールを保存');
  expect(screen.queryByText('このスタッフは勤務時間が未登録のため、まだネット予約を受けられません。')).toBeNull();
  expect(mockFrom).not.toHaveBeenCalledWith('facility_profiles');
  expect(dayBox('月').checked).toBe(true); expect(dayBox('火').checked).toBe(false);
  expect(mockGuard).toHaveBeenLastCalledWith(false);
});

// スマホ（幅 320〜390px）で終了時刻がカードの外へはみ出し、ページが横にスクロールしていた。
// 曜日の行は折り返し、時刻の入力は狭い画面では行の幅を分け合う（固定幅は sm 以上だけ）。
test('weekday rows wrap the time inputs below the day on narrow screens instead of overflowing', async () => {
  scheduleTables({ schedules: [{ day_of_week: 1, start_time: '12:00:00', end_time: '18:00:00' }], businessHours: SHOP_HOURS });
  render(<Schedule />);
  await screen.findByText('スケジュールを保存');
  const row = dayBox('月').closest('label')!.parentElement!;
  expect(row.className.split(/\s+/)).toContain('flex-wrap');
  const times = Array.from(row.querySelectorAll('input[type="time"]'));
  expect(times).toHaveLength(2);
  for (const input of times) {
    const classes = input.className.split(/\s+/);
    expect(classes).not.toContain('w-32!'); // 幅を固定するのは sm 以上だけ
    expect(classes).toEqual(expect.arrayContaining(['min-w-0', 'flex-1', 'sm:w-32!']));
  }
  expect(times[0].parentElement!.className.split(/\s+/)).toEqual(expect.arrayContaining(['w-full', 'sm:w-auto']));
});

test('when the shop hours cannot be read, the editor is not shown (no guessed defaults)', async () => {
  scheduleTables({ facilityError: { message: 'synthetic outage' } });
  render(<Schedule />);
  await screen.findByText(/読み込みに失敗/);
  expect(screen.queryByText('この勤務時間で保存する')).toBeNull();
  expect(mockFetch).not.toHaveBeenCalled();
});

test('creating a staff member opens that staff member\'s schedule editor instead of returning to the list', async () => {
  const staffId = '66000000-0000-4000-8000-000000000042';
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ staff: { id: staffId }, replayed: false }) }); render(<NewStaff />);
  fireEvent.change(await screen.findByLabelText(/名前/), { target: { value: '合成スタッフ' } });
  fireEvent.click(screen.getByText('スタッフを追加'));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/admin/staff/${staffId}/schedule?facility_id=${facility}&added=1`));
  expect(mockPush).toHaveBeenCalledTimes(1);
});

// ─── LINE WORKS（2026年10月23日） ────────────────────────────────────────────────
// 連携の設定案内は Client Secret・Private Key をメールで運営へ送らせていた。安全な受け渡し方法ができるまで、
// 新しく設定させない（設定済みのスタッフのデータは残し、編集画面では引き続き編集できる）。
test('スタッフ追加では LINE Works の設定欄を出さず、送りもしない', async () => {
  mockFetch.mockResolvedValue({ ok: true }); render(<NewStaff />);
  fireEvent.change(await screen.findByLabelText(/名前/), { target: { value: '合成スタッフ' } });
  expect(screen.queryByText('LINE Works 通知設定')).toBeNull();
  expect(screen.queryByLabelText('LINE Works チャンネルID')).toBeNull();
  fireEvent.click(screen.getByText('スタッフを追加'));
  await waitFor(() => expect(mockFetch).toHaveBeenCalled());
  expect(Object.keys(JSON.parse(mockFetch.mock.calls[0][1].body))).not.toContain('line_works_channel_id');
});

function editTables(staff: Record<string, unknown>) {
  mockFrom.mockImplementation((table: string) => {
    const result = table === 'staff_profiles' ? { data: { id: 'synthetic-staff', name: '合成スタッフ', ...staff }, error: null } : { data: [], error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order']) chain[method] = () => chain;
    chain.single = async () => result; chain.then = (resolve: (value: unknown) => unknown) => resolve(result); return chain;
  });
}

test.each([
  [{ line_works_channel_id: null }, false],
  [{ line_works_channel_id: '12345678901234567', line_works_notify_all: true }, true],
])('スタッフ編集では、設定済みのときだけ LINE Works の欄を出す %#', async (staff, shown) => {
  editTables(staff);
  const params = Promise.resolve({ id: 'synthetic-staff' });
  await act(async () => { render(<React.Suspense fallback={<p>準備中</p>}><EditStaff params={params} /></React.Suspense>); });
  await screen.findByDisplayValue('合成スタッフ');
  expect(Boolean(screen.queryByText('LINE Works 通知設定'))).toBe(shown);
});
