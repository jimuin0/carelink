import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminSettingsPage from '../page';

const first = '71000000-0000-4000-8000-000000000001';
const second = '71000000-0000-4000-8000-000000000002';
let mockRequested: string | null = second;
let mockProfile: Record<string, unknown>;
let mockReads: string[];
const mockFetch = jest.fn();
const mockDb = jest.fn();
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
  mockDb.mockReturnValue({
    auth: { getUser: async () => ({ data: { user: { id: 'synthetic-user' } } }) },
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
