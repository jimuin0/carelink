import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminSettingsPage from '../page';

const first = '71000000-0000-4000-8000-000000000001';
const second = '71000000-0000-4000-8000-000000000002';
let mockRequested: string | null = second;
let mockProfile: Record<string, unknown>;
let mockReads: string[];
let mockSetup: Record<string, { data?: unknown; count?: number | null; error: unknown }>;
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
  mockSetup = {
    facility_menus: { count: 0, error: null },
    facility_photos: { count: 1, error: null },
    staff_profiles: { data: [], error: null },
  };
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
      if (table === 'facility_profiles') {
        // 編集フォームの読み込み（select('*')）だけを数える。準備状況の読み込みも同じ表を読む。
        let columns = '';
        const chain = { select: (c: string) => { columns = c; return chain; },
          eq: (_key: string, value: string) => { if (columns === '*') mockReads.push(value); return chain; },
          single: async () => ({ data: mockProfile, error: null }) };
        return chain;
      }
      // ネット予約の準備状況（保存済みのメニュー・写真・勤務するスタッフ）
      const result = mockSetup[table];
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'or', 'gte', 'not', 'limit']) chain[m] = () => chain;
      chain.then = (resolve: (value: unknown) => unknown) => resolve(result);
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
  expect(screen.getByRole('textbox', { name: /町名・番地/ }).getAttribute('maxlength')).toBe('500');
  fireEvent.click(screen.getAllByRole('button', { name: '保存する' })[0]);
  // 営業時間を送らなかったことを、成功の表示の中で伝える（黙って「保存しました」だけにしない）
  await screen.findByText('施設情報を保存しました。営業時間はまだ入力されていないため、ネット予約は始まりません');
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
  await screen.findByText(/^施設情報を保存しました。営業時間はまだ入力されていない/);
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
    fireEvent.change(screen.getByRole('textbox', { name: /町名・番地/ }), { target: { value: '神南1-1' } });
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
    await screen.findByText(/^施設情報を保存しました/);
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

// ─── 初回ログインから公開までの導線（2026年10月23日） ───────────────────────────
const DAY_NAMES = ['月', '火', '水', '木', '金', '土', '日'];
const openInput = (day: string) => screen.getByLabelText(`${day}曜日の開店時間`) as HTMLInputElement;
const closeInput = (day: string) => screen.getByLabelText(`${day}曜日の閉店時間`) as HTMLInputElement;
const save = () => fireEvent.click(screen.getAllByRole('button', { name: '保存する' })[0]);

describe('営業時間', () => {
  test('未保存の店舗は空欄から始める（09:00〜19:00 を黙って入れない）', async () => {
    render(<AdminSettingsPage />);
    await screen.findByDisplayValue('合成店舗B');
    for (const day of DAY_NAMES) {
      expect(openInput(day).value).toBe('');
      expect(closeInput(day).value).toBe('');
    }
    expect(screen.queryByDisplayValue('09:00')).toBeNull();
    // 確認用のチェックボックスは無い（入力したら、それを確認とみなす）
    expect(screen.queryByLabelText(/予約用設定として保存する/)).toBeNull();
  });

  // 以前は確認のチェックを入れない限り、入力した営業時間は保存内容から外され、それでも「保存しました」と出た。
  test('営業時間を入力したら確認とみなして保存する（チェックボックス不要）', async () => {
    render(<AdminSettingsPage />);
    await screen.findByDisplayValue('合成店舗B');
    fireEvent.change(openInput('月'), { target: { value: '10:00' } });
    fireEvent.change(closeInput('月'), { target: { value: '19:00' } });
    fireEvent.click(screen.getByRole('button', { name: '最初に入力した曜日の時間を、ほかの営業日にも入れる' }));
    fireEvent.click(screen.getByLabelText('日曜日に営業する'));
    save();
    await screen.findByText('施設情報を保存しました');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.business_hours).toEqual({
      mon: { open: '10:00', close: '19:00' }, tue: { open: '10:00', close: '19:00' }, wed: { open: '10:00', close: '19:00' },
      thu: { open: '10:00', close: '19:00' }, fri: { open: '10:00', close: '19:00' }, sat: { open: '10:00', close: '19:00' }, sun: null,
    });
  });

  test('入力しかけの営業時間があれば、保存全体を止めてどの曜日かを示す（成功と表示しない）', async () => {
    render(<AdminSettingsPage />);
    await screen.findByDisplayValue('合成店舗B');
    fireEvent.change(openInput('月'), { target: { value: '10:00' } });
    save();
    const message = '月曜日の開店・閉店時間を入力してください（休みの曜日は「営業」のチェックを外してください）';
    await screen.findByText(message, { selector: '[role="status"]' });
    expect(screen.getByText(message, { selector: 'p.text-red-700' })).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.queryByText(/^施設情報を保存しました/)).toBeNull();
  });

  test('時間を写す元が無ければ、先に入力するよう伝える', async () => {
    render(<AdminSettingsPage />);
    await screen.findByDisplayValue('合成店舗B');
    fireEvent.click(screen.getByRole('button', { name: '最初に入力した曜日の時間を、ほかの営業日にも入れる' }));
    await screen.findByText('先にいずれかの曜日の開店・閉店時間を入力してください');
  });
});

describe('保存の入力確認', () => {
  test('施設名が空なら理由を示し、施設名の欄へ移る', async () => {
    render(<AdminSettingsPage />);
    const name = await screen.findByDisplayValue('合成店舗B');
    fireEvent.change(name, { target: { value: '  ' } });
    save();
    await screen.findByText('施設名を入力してください', { selector: '[role="status"]' });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /施設名/ }));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('スキームの無い Web サイトは https:// を補って送り、入力欄も合わせる', async () => {
    render(<AdminSettingsPage />);
    await screen.findByDisplayValue('合成店舗B');
    fireEvent.change(screen.getByRole('textbox', { name: 'Webサイト' }), { target: { value: 'www.example.com' } });
    save();
    await screen.findByText(/^施設情報を保存しました/);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).website_url).toBe('https://www.example.com');
    expect(screen.getByDisplayValue('https://www.example.com')).toBeTruthy();
  });

  test('サーバーが断った欄の理由を、その欄の下に出す', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({
      error: '入力内容を確認してください：Webサイト',
      fields: { website_url: 'WebサイトのURLを確認してください（例: https://example.com）' },
    }) });
    render(<AdminSettingsPage />);
    await screen.findByDisplayValue('合成店舗B');
    save();
    await screen.findByText('入力内容を確認してください：Webサイト');
    const web = screen.getByRole('textbox', { name: 'Webサイト' });
    expect(web.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(web.getAttribute('aria-describedby') as string)?.textContent)
      .toBe('WebサイトのURLを確認してください（例: https://example.com）');
  });
});

describe('ネット予約の準備状況', () => {
  test('足りない項目を、それぞれの画面へのリンクつきで並べる', async () => {
    render(<AdminSettingsPage />);
    await screen.findByDisplayValue('合成店舗B');
    const section = await screen.findByRole('region', { name: 'ネット予約の準備状況' });
    await waitFor(() => expect(section.textContent).toContain('あと4項目'));
    const link = (name: string) => screen.getByRole('link', { name }).getAttribute('href');
    expect(link('無料掲載を公開')).toBe(`/admin/settings?facility_id=${second}`);
    expect(link('営業時間の入力・保存')).toBe(`/admin/settings?facility_id=${second}`);
    expect(link('公開メニュー登録')).toBe(`/admin/menus?facility_id=${second}`);
    expect(link('スタッフ登録と勤務時間の保存')).toBe(`/admin/staff?facility_id=${second}`);
    // 写真は登録済み
    expect(screen.queryByRole('link', { name: '写真アップロード' })).toBeNull();
    expect(section.textContent).toContain('済み：写真アップロード');
    expect(section.id).toBe('booking-readiness');
  });

  test('読み込めなければ、未完了と偽らずに読み込めなかったと伝える', async () => {
    mockSetup.staff_profiles = { data: null, error: { message: 'synthetic' } };
    render(<AdminSettingsPage />);
    await screen.findByDisplayValue('合成店舗B');
    await screen.findByText('準備状況を読み込めませんでした。');
  });
});

test('LINE WORKS の秘密情報をメールで送らせる案内を出さない', async () => {
  render(<AdminSettingsPage />);
  await screen.findByDisplayValue('合成店舗B');
  expect(screen.queryByText(/Client Secret/)).toBeNull();
  expect(screen.queryByText(/LINE Works連携/)).toBeNull();
});

test('公開中の店舗には「掲載ページを見る」を出す', async () => {
  mockProfile = { ...mockProfile, status: 'published', slug: 'synthetic-shop' };
  render(<AdminSettingsPage />);
  await screen.findByDisplayValue('合成店舗B');
  expect(screen.getByRole('link', { name: '掲載ページを見る' }).getAttribute('href')).toBe('/facility/synthetic-shop');
});
