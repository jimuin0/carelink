/**
 * スタッフ追加フォーム（2026年10月23日）。
 * - 得意分野は半角カンマでしか区切っておらず、「カット、カラー」が 1 件として保存されていた。
 * - 入力例が美容室向け（「スタイリスト」「カット, カラー, パーマ」）に固定で、どの業種にも出ていた。
 * - 読み込み中・失敗が素の文字だけで、失敗からやり直す手段が無かった。ログイン切れも素の文字だった。
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NewStaff from '../new/page';

const facility = '71000000-0000-4000-8000-000000000002';
const mockPush = jest.fn();
const mockRouter = { push: mockPush };
const mockSelection = jest.fn();
const mockGetUser = jest.fn();
const mockFetch = jest.fn();
let mockBusinessType: string | null = null;
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter, useSearchParams: () => new URLSearchParams(`facility_id=${facility}`) }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => ({
  auth: { getUser: mockGetUser },
  from: (table: string) => {
    const chain = { select: () => chain, eq: () => chain,
      maybeSingle: async () => (table === 'facility_profiles' ? { data: { business_type: mockBusinessType }, error: null } : { data: null, error: { message: 'unexpected' } }) };
    return chain;
  },
}) }));
jest.mock('@/lib/admin-facility-selection', () => ({ loadAdminFacilitySelection: (...args: unknown[]) => mockSelection(...args) }));
jest.mock('@/components/admin/FacilitySelector', () => ({ __esModule: true, default: () => null }));

beforeEach(() => {
  jest.clearAllMocks(); sessionStorage.clear(); mockBusinessType = null;
  global.fetch = mockFetch;
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ staff: { id: '71000000-0000-4000-8000-0000000000aa' } }) });
  mockGetUser.mockResolvedValue({ data: { user: { id: 'synthetic-owner' } }, error: null });
  mockSelection.mockResolvedValue({ choices: [{ id: facility, name: '合成店舗' }], selectedId: facility });
});

const posted = () => JSON.parse(mockFetch.mock.calls.find(([, options]) => options?.method === 'POST')[1].body);

test.each([
  ['カット、カラー、パーマ', ['カット', 'カラー', 'パーマ']],
  ['鍼灸，整体', ['鍼灸', '整体']],
  ['ボディケア 、 アロマ、', ['ボディケア', 'アロマ']],
  ['ジェルネイル, ケア', ['ジェルネイル', 'ケア']],
])('得意分野 %p を項目ごとに分けて保存する', async (input, expected) => {
  render(<NewStaff />);
  fireEvent.change(await screen.findByLabelText(/名前/), { target: { value: '合成スタッフ' } });
  fireEvent.change(screen.getByLabelText(/得意分野/), { target: { value: input } });
  fireEvent.click(screen.getByRole('button', { name: 'スタッフを追加' }));
  await waitFor(() => expect(mockPush).toHaveBeenCalled());
  expect(posted().specialties).toEqual(expected);
});

test.each([
  ['鍼灸院・整骨院', '院長、鍼灸師、柔道整復師等', '鍼灸、骨盤調整'],
  ['ヘアサロン', '店長、スタイリスト、アシスタント等', 'カット、カラー、パーマ'],
  [null, '店長、スタッフ等', '得意な施術・メニュー'],
])('業種 %p に合った入力例を出す', async (type, position, specialties) => {
  mockBusinessType = type;
  render(<NewStaff />);
  await screen.findByLabelText(/名前/);
  expect(screen.getByLabelText('役職').getAttribute('placeholder')).toBe(position);
  expect(screen.getByLabelText(/得意分野/).getAttribute('placeholder')).toBe(specialties);
});

test('名前が空なら送らずに「名前は必須です」', async () => {
  render(<NewStaff />);
  await screen.findByLabelText(/名前/);
  fireEvent.click(screen.getByRole('button', { name: 'スタッフを追加' }));
  expect(await screen.findByText('名前は必須です')).toBeTruthy();
  expect(mockFetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
});

test('読み込み中は共通の読み込み表示を出し、追加ボタンも名前の警告も出さない', async () => {
  let release: (value: unknown) => void = () => undefined;
  mockSelection.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
  render(<NewStaff />);
  await waitFor(() => expect(mockSelection).toHaveBeenCalled());
  // 管理画面共通の読み込み表示（以前はこの画面だけ素の「読み込み中...」の段落だった）
  expect(screen.getByLabelText('読み込み中')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'スタッフを追加' })).toBeNull();
  expect(screen.queryByText('名前は必須です')).toBeNull();
  release({ choices: [{ id: facility, name: '合成店舗' }], selectedId: facility });
  expect(await screen.findByRole('button', { name: 'スタッフを追加' })).toBeTruthy();
});

test('読み込みに失敗したら再試行でやり直せる', async () => {
  mockSelection.mockRejectedValueOnce(new Error('synthetic outage'));
  render(<NewStaff />);
  expect(await screen.findByText('店舗情報の取得に失敗しました')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  expect(await screen.findByRole('button', { name: 'スタッフを追加' })).toBeTruthy();
});

test('ログインが切れていたら、この画面へ戻るログインの導線を出す', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  render(<NewStaff />);
  expect((await screen.findByRole('alert')).textContent).toContain('セッションが切れました。再ログインしてください。');
  expect(screen.getByRole('link', { name: 'ログインし直す' }).getAttribute('href'))
    .toBe(`/auth/login?redirect=${encodeURIComponent(`/admin/staff/new?facility_id=${facility}`)}`);
  expect(mockSelection).not.toHaveBeenCalled();
});
