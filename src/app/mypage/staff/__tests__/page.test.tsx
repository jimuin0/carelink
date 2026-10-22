/** @jest-environment jsdom */
/**
 * マイページ「指名スタッフ」。
 * 指名したスタッフが施設名と、実際に開けるリンク付きで並び、「指名を解除」で外せること。
 * 空のときの案内が、実在する登録手段（施設ページの「スタッフ」→「指名登録」）を指していること。
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Page from '../page';

let prefs: { data: unknown; error: unknown };
let staffRows: unknown[];
let facilityRows: unknown[];
const mockGetUser = jest.fn();
jest.mock('next/image', () => ({ __esModule: true, default: (props: { alt: string }) => <span data-alt={props.alt} /> }));
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getUser: mockGetUser },
    from: (table: string) => ({
      select: () => ({
        eq: async () => (table === 'user_preferred_staff' ? prefs : { data: null, error: null }),
        in: async () => ({ data: table === 'staff_profiles' ? staffRows : facilityRows, error: null }),
      }),
    }),
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'synthetic-user' } } });
  prefs = { data: [{ id: 'pref-1', staff_id: 'staff-1' }, { id: 'pref-2', staff_id: 'staff-2' }], error: null };
  staffRows = [
    { id: 'staff-1', name: '花子', slug: 'hanako', photo_url: null, position: 'スタイリスト', facility_id: 'fac-1', is_active: true },
    { id: 'staff-2', name: '太郎', slug: 'taro', photo_url: null, position: null, facility_id: 'fac-1', is_active: false },
  ];
  facilityRows = [{ id: 'fac-1', name: 'サンプル整骨院', slug: 'sample-clinic' }];
  global.fetch = jest.fn();
  Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: () => new AbortController().signal });
});

test('指名したスタッフを、プロフィールと施設へのリンク付きで並べる', async () => {
  render(<Page />);
  const profile = await screen.findByRole('link', { name: '花子' });
  expect(profile).toHaveAttribute('href', '/facility/sample-clinic/staff/hanako');
  expect(screen.getAllByRole('link', { name: 'サンプル整骨院' })[0]).toHaveAttribute('href', '/facility/sample-clinic');
  expect(screen.getByText('スタイリスト')).toBeVisible();
  // 非表示になったスタッフは詳細ページが 404 になるので、名前をリンクにしない
  expect(screen.getByText('太郎')).toBeVisible();
  expect(screen.queryByRole('link', { name: '太郎' })).not.toBeInTheDocument();
});

test('施設が非公開になったスタッフは、その旨を出してリンクしない', async () => {
  facilityRows = [];
  render(<Page />);
  expect(await screen.findByText('花子')).toBeVisible();
  expect(screen.queryByRole('link', { name: '花子' })).not.toBeInTheDocument();
  expect(screen.getAllByText('現在公開されていない施設のスタッフです')).toHaveLength(2);
});

test('「指名を解除」は API を通して外し、一覧から消す', async () => {
  (fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ nominated: false }) });
  render(<Page />);
  fireEvent.click(await screen.findByRole('button', { name: '指名を解除（花子さん）' }));
  await waitFor(() => expect(screen.queryByText('花子')).not.toBeInTheDocument());
  expect(fetch).toHaveBeenCalledWith('/api/preferred-staff', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ staffId: 'staff-1', nominated: false }),
  }));
  expect(await screen.findByText('指名を解除しました')).toBeVisible();
  expect(screen.getByText('太郎')).toBeVisible();
});

test.each([
  ['API が失敗を返した', () => (fetch as jest.Mock).mockResolvedValue({ ok: false, json: async () => ({ error: 'x' }) }), '解除に失敗しました。時間をおいて再度お試しください。'],
  ['成功応答の中身が合わない', () => (fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => { throw new Error('bad'); } }), '解除に失敗しました。時間をおいて再度お試しください。'],
  ['通信に失敗した', () => (fetch as jest.Mock).mockRejectedValue(new Error('offline')), '解除に失敗しました。通信状況を確認して再度お試しください。'],
])('%s場合は一覧に残して伝える', async (_label, arrange, text) => {
  arrange();
  render(<Page />);
  fireEvent.click(await screen.findByRole('button', { name: '指名を解除（花子さん）' }));
  expect(await screen.findByText(text)).toBeVisible();
  expect(screen.getByText('花子')).toBeVisible();
  await waitFor(() => expect(screen.getByRole('button', { name: '指名を解除（花子さん）' })).toBeEnabled());
});

test('解除の送信中は他の解除ボタンも押せない（二重送信しない）', async () => {
  (fetch as jest.Mock).mockReturnValue(new Promise(() => {}));
  render(<Page />);
  fireEvent.click(await screen.findByRole('button', { name: '指名を解除（花子さん）' }));
  expect(screen.getByRole('button', { name: '指名を解除（太郎さん）' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '指名を解除（太郎さん）' }));
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('まだ誰も指名していないときは、実在する登録手段を案内する', async () => {
  prefs = { data: [], error: null };
  render(<Page />);
  expect(await screen.findByText('指名スタッフが登録されていません')).toBeVisible();
  const empty = screen.getByText('指名スタッフが登録されていません').parentElement!;
  expect(within(empty).getByText('施設ページの「スタッフ」で、スタッフごとの「指名登録」ボタンから登録できます。')).toBeVisible();
  expect(within(empty).getByRole('link', { name: '施設を探す' })).toHaveAttribute('href', '/search');
});

test('読み込みに失敗したら空一覧ではなく再試行を出す', async () => {
  prefs = { data: null, error: { message: 'down' } };
  render(<Page />);
  expect(await screen.findByText('指名スタッフの読み込みに失敗しました')).toBeVisible();
  expect(screen.queryByText('指名スタッフが登録されていません')).not.toBeInTheDocument();
});
