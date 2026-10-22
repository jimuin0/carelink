import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminSettingsPage from '../page';

const first = '71000000-0000-4000-8000-000000000001';
const second = '71000000-0000-4000-8000-000000000002';
let mockRequested: string | null = second;
let mockProfile: Record<string, unknown>;
let mockReads: string[];
const mockFetch = jest.fn();
const mockDb = jest.fn();
const mockGetUser = jest.fn();
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }), useSearchParams: () => ({ get: () => mockRequested }) }));
jest.mock('next/dynamic', () => ({ __esModule: true, default: () => () => null }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => mockDb() }));
jest.mock('@/components/Toast', () => ({ __esModule: true, default: ({ message }: { message: string }) => <p role="status">{message}</p> }));

beforeEach(() => {
  jest.clearAllMocks(); mockRequested = second; mockReads = [];
  mockProfile = { name: '合成店舗B', business_type: 'ヘアサロン', prefecture: '愛知県', city: '合成市', address: '合成番地',
    business_hours: null, business_hours_text: '平日10時から18時、火曜休み', status: 'draft' };
  global.fetch = mockFetch;
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  mockGetUser.mockReset().mockResolvedValue({ data: { user: { id: 'synthetic-user' } }, error: null });
  mockDb.mockReturnValue({
    auth: { getUser: mockGetUser },
    from: (table: string) => {
      if (table === 'facility_members') {
        const chain = { select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
          limit: async () => ({ data: [{ facility_id: first, facility_profiles: { name: '合成店舗A' } },
            { facility_id: second, facility_profiles: { name: '合成店舗B' } }], error: null }) };
        return chain;
      }
      const chain = { select: () => chain, eq: (_key: string, value: string) => { mockReads.push(value); return chain; },
        single: async () => ({ data: mockProfile, error: null }) };
      return chain;
    },
  });
});

test.each(['error', 'throw', 'malformed', 'user-with-error'])('Auth %s shows retry rather than empty settings, preserving the requested tenant', async mode => {
  if (mode === 'throw') mockGetUser.mockRejectedValueOnce(new Error('synthetic dependency failure'));
  else mockGetUser.mockResolvedValueOnce(mode === 'malformed' ? {} : {
    data: { user: mode === 'user-with-error' ? { id: 'synthetic-user' } : null }, error: { status: 522 },
  });
  render(<AdminSettingsPage />);
  await screen.findByRole('alert');
  expect(screen.queryByRole('textbox', { name: /施設名/ })).toBeNull();
  expect(mockReads).toEqual([]); expect(mockFetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  await screen.findByDisplayValue('合成店舗B');
  expect(mockReads).toEqual([second]); expect(mockGetUser).toHaveBeenCalledTimes(2);
  expect(mockRequested).toBe(second); expect(mockFetch).not.toHaveBeenCalled();
});

test('successful anonymous verification does not expose or save tenant settings', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  render(<AdminSettingsPage />);
  await waitFor(() => expect(mockGetUser).toHaveBeenCalled());
  expect(screen.queryByRole('textbox', { name: /施設名/ })).toBeNull();
  expect(mockReads).toEqual([]); expect(mockFetch).not.toHaveBeenCalled();
});
test('facility selection dependency failure also exposes retry, never the empty editor', async () => {
  const original = mockDb();
  const failing = { select: () => failing, eq: () => failing, in: () => failing, order: () => failing,
    limit: async () => { throw new Error('synthetic private dependency'); } };
  mockDb.mockReturnValueOnce({ ...original, from: () => failing });
  render(<AdminSettingsPage />);
  await screen.findByRole('alert');
  expect(screen.queryByRole('textbox', { name: /施設名/ })).toBeNull();
  expect(mockReads).toEqual([]); expect(mockFetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  await screen.findByDisplayValue('合成店舗B'); expect(mockReads).toEqual([second]);
  expect(mockFetch).not.toHaveBeenCalled();
});

test('複数店舗で未選択なら基本情報を読まず保存できない', async () => {
  mockRequested = null;
  render(<AdminSettingsPage />);
  await screen.findByText('編集する店舗を選択してください');
  expect(mockReads).toEqual([]);
  expect(screen.queryByRole('textbox', { name: /施設名/ })).toBeNull();
  expect(mockFetch).not.toHaveBeenCalled();
});

test('未確認の営業時間を既定09時19時で上書きせず、入力情報と長文上限を保持する', async () => {
  render(<AdminSettingsPage />);
  await screen.findByDisplayValue('合成店舗B');
  expect(screen.getByText(/申込時の営業時間：平日10時/)).toBeTruthy();
  expect(screen.getByRole('textbox', { name: /施設名/ }).getAttribute('maxlength')).toBe('200');
  expect(screen.getByRole('textbox', { name: /番地/ }).getAttribute('maxlength')).toBe('500');
  fireEvent.click(screen.getAllByRole('button', { name: '保存する' })[0]);
  await screen.findByText('施設情報を保存しました');
  expect(mockReads).toEqual([second]);
  const [url, options] = mockFetch.mock.calls[0];
  expect(url).toBe(`/api/admin/settings?facility_id=${second}`);
  expect(JSON.parse(options.body)).not.toHaveProperty('business_hours');
});

test.each([
  { mon: { open: '10:00', close: '18:00' } },
  { mon: { open: '18:00', close: '10:00' }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null },
  { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null },
])('不完全・不正な既存営業時間を、名前の保存だけで確認済み7曜日へ変換しない：%p', async businessHours => {
  mockProfile.business_hours = businessHours;
  render(<AdminSettingsPage />);
  const name = await screen.findByDisplayValue('合成店舗B');
  fireEvent.change(name, { target: { value: '名称のみ更新' } });
  fireEvent.click(screen.getAllByRole('button', { name: '保存する' })[0]);
  await screen.findByText('施設情報を保存しました');
  expect(JSON.parse(mockFetch.mock.calls[0][1].body)).not.toHaveProperty('business_hours');
});

test('正常な全7曜日の営業時間は保存時にも維持する', async () => {
  const hours = { mon: { open: '10:00', close: '18:00' }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
  mockProfile.business_hours = hours;
  render(<AdminSettingsPage />);
  await screen.findByDisplayValue('合成店舗B');
  fireEvent.click(screen.getAllByRole('button', { name: '保存する' })[0]);
  await screen.findByText('施設情報を保存しました');
  expect(JSON.parse(mockFetch.mock.calls[0][1].body).business_hours).toEqual(hours);
});

test.each(['business-failure', 'invalid-json', 'http-failure'])('保存結果が不確定なら成功表示も入力破棄もしない：%s', async mode => {
  mockFetch.mockResolvedValue({ ok: mode !== 'http-failure', json: async () => {
    if (mode === 'invalid-json') throw new Error('synthetic invalid JSON');
    return { ok: false };
  } });
  render(<AdminSettingsPage />);
  const input = await screen.findByDisplayValue('合成店舗B');
  fireEvent.change(input, { target: { value: '保持する合成店舗名' } });
  fireEvent.click(screen.getAllByRole('button', { name: '保存する' })[0]);
  await screen.findByText('保存結果を確認できませんでした。入力内容を保持しています');
  expect(screen.queryByText('施設情報を保存しました')).toBeNull();
  expect(screen.getByDisplayValue('保持する合成店舗名')).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: '合成店舗A' }));
  fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
  expect(mockPush).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue('保持する合成店舗名')).toBeTruthy();
});

test('選択店舗が変わったとき前店舗の編集内容を引き継がない', async () => {
  const { rerender } = render(<AdminSettingsPage />);
  await screen.findByDisplayValue('合成店舗B');
  mockRequested = first; mockProfile = { ...mockProfile, name: '合成店舗A' };
  rerender(<AdminSettingsPage />);
  await waitFor(() => expect(screen.queryByDisplayValue('合成店舗B')).toBeNull());
  await screen.findByDisplayValue('合成店舗A');
  expect(mockReads).toEqual([second, first]);
});

test('予約用の設定がなくても所在地のある店舗を掲載公開できる', async () => {
  render(<AdminSettingsPage />);
  await screen.findByDisplayValue('合成店舗B');
  fireEvent.click(screen.getByRole('button', { name: '公開する' }));
  await screen.findByText('施設を公開しました！');
  expect(screen.getByText('公開中')).toBeTruthy();
  expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ status: 'published' });
});

test.each(['business-failure', 'invalid-json', 'http-failure'])('公開の成功を確認できなければ非公開表示を維持：%s', async mode => {
  mockFetch.mockResolvedValue({ ok: mode !== 'http-failure', json: async () => {
    if (mode === 'invalid-json') throw new Error('synthetic invalid JSON');
    return { ok: false };
  } });
  render(<AdminSettingsPage />);
  await screen.findByDisplayValue('合成店舗B');
  fireEvent.click(screen.getByRole('button', { name: '公開する' }));
  await screen.findByText('公開に失敗しました');
  expect(screen.getByText('非公開')).toBeTruthy();
  expect(screen.queryByText('施設を公開しました！')).toBeNull();
});

// ─── E9: 「公開する」は画面に見えている内容で判定する ─────────────────────────────
// 以前は保存済みの（空の）所在地で判定し、入力したばかりの住所を「未設定」として拒否していた。
describe('公開は画面の入力どおりに行う', () => {
  const fillLocation = async () => {
    fireEvent.change(await screen.findByLabelText(/都道府県/), { target: { value: '東京都' } });
    fireEvent.change(screen.getByRole('textbox', { name: /市区町村/ }), { target: { value: '渋谷区' } });
    fireEvent.change(screen.getByRole('textbox', { name: /番地/ }), { target: { value: '神南1-1' } });
  };
  beforeEach(() => { mockProfile = { ...mockProfile, prefecture: '', city: '', address: '' }; });

  test('未保存の住所を入力して公開すると、先に保存してから公開する', async () => {
    render(<AdminSettingsPage />);
    await screen.findByDisplayValue('合成店舗B');
    await fillLocation();
    fireEvent.click(screen.getByRole('button', { name: '保存して公開する' }));
    await screen.findByText('施設を公開しました！');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [saveUrl, save] = mockFetch.mock.calls[0];
    expect(saveUrl).toBe(`/api/admin/settings?facility_id=${second}`);
    expect(JSON.parse(save.body)).toMatchObject({ prefecture: '東京都', city: '渋谷区', address: '神南1-1' });
    const [publishUrl, publish] = mockFetch.mock.calls[1];
    expect(publishUrl).toBe(`/api/admin/settings?facility_id=${second}&action=status`);
    expect(JSON.parse(publish.body)).toEqual({ status: 'published' });
    expect(screen.getByText('公開中')).toBeTruthy();
  });

  test('画面で空の項目があれば、送信せずに足りない項目をそのまま一覧にする', async () => {
    render(<AdminSettingsPage />);
    await screen.findByDisplayValue('合成店舗B');
    fireEvent.click(screen.getByRole('button', { name: '公開する' }));
    const alert = await screen.findByRole('alert');
    // 一覧には未入力だけでなく直す表現も並ぶので、見出しは「直してください」
    expect(alert.textContent).toContain('公開するには、次の点を直してください。');
    expect(alert.textContent).not.toContain('保存済みの内容では');
    expect([...alert.querySelectorAll('li')].map(li => li.textContent)).toEqual(['都道府県を設定してください', '市区町村を設定してください', '住所を設定してください']);
    expect(mockFetch).not.toHaveBeenCalled();
    // 入力して保存すると、古い一覧は消える
    await fillLocation();
    fireEvent.click(screen.getAllByRole('button', { name: '保存する' })[0]);
    await screen.findByText('施設情報を保存しました');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('保存に失敗したら公開しない', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'キャッチコピーを見直してください' }) });
    render(<AdminSettingsPage />);
    await screen.findByDisplayValue('合成店舗B');
    await fillLocation();
    fireEvent.click(screen.getByRole('button', { name: '保存して公開する' }));
    await screen.findByText('キャッチコピーを見直してください');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText('非公開')).toBeTruthy();
  });

  test('サーバーが返した不足項目は、消えるトーストではなく画面に残す', async () => {
    mockProfile = { ...mockProfile, prefecture: '愛知県', city: '合成市', address: '合成番地' };
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: '公開するには次の項目が必要です', missing: ['施設紹介：表現を見直してください', 42] }) });
    render(<AdminSettingsPage />);
    await screen.findByDisplayValue('合成店舗B');
    fireEvent.click(screen.getByRole('button', { name: '公開する' }));
    const alert = await screen.findByRole('alert');
    expect([...alert.querySelectorAll('li')].map(li => li.textContent)).toEqual(['施設紹介：表現を見直してください']);
    // 画面では入力済みに見えても、サーバーは保存済みの内容で判断したことを先に伝える
    expect(alert.textContent).toContain('保存済みの内容では次の点が足りないため、公開できませんでした。');
    expect(screen.getByText('公開できませんでした。足りない項目を確認してください')).toBeTruthy();
    expect(screen.getByText('非公開')).toBeTruthy();
  });

  test('画面の PR 文言が公開ゲートに止められる表現なら、送信せずに表現の見直しを一覧にする', async () => {
    mockProfile = { ...mockProfile, prefecture: '愛知県', city: '合成市', address: '合成番地', catch_copy: '地域No.1' };
    render(<AdminSettingsPage />);
    await screen.findByDisplayValue('合成店舗B');
    fireEvent.click(screen.getByRole('button', { name: '公開する' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('公開するには、次の点を直してください。');
    expect([...alert.querySelectorAll('li')].map(li => li.textContent?.slice(0, 7))).toEqual(['キャッチコピー']);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('サーバーが不足項目なしで断ったら、一覧は出さずにエラーを伝える', async () => {
    mockProfile = { ...mockProfile, prefecture: '愛知県', city: '合成市', address: '合成番地' };
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: '権限がありません' }) });
    render(<AdminSettingsPage />);
    await screen.findByDisplayValue('合成店舗B');
    fireEvent.click(screen.getByRole('button', { name: '公開する' }));
    await screen.findByText('権限がありません');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('通信エラーでもボタンを固着させない', async () => {
    mockProfile = { ...mockProfile, prefecture: '愛知県', city: '合成市', address: '合成番地' };
    mockFetch.mockRejectedValueOnce(new Error('synthetic network'));
    render(<AdminSettingsPage />);
    await screen.findByDisplayValue('合成店舗B');
    fireEvent.click(screen.getByRole('button', { name: '公開する' }));
    await screen.findByText('通信エラーが発生しました');
    expect((screen.getByRole('button', { name: '公開する' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

test('both GBP entry links preserve the explicitly selected second facility',async()=>{
 render(<AdminSettingsPage/>);await screen.findByDisplayValue('合成店舗B');
 expect(screen.getByRole('link',{name:'GBP管理画面へ →',exact:true}).getAttribute('href')).toBe('/admin/gbp?facility_id='+second);
 expect(screen.getByRole('link',{name:'GBP設定・診断を開く',exact:true}).getAttribute('href')).toBe('/admin/gbp?facility_id='+second);
});
