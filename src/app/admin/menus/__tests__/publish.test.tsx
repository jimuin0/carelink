import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Page from '../page';

// HPB 一括反映のメニューは非公開で作られる。以前のメニュー管理には公開手段が無く、
// 店舗はネット予約を始められなかった。公開／非公開の表示と切替を固定する。
const facility = '00000000-0000-4000-8000-000000000002';
const draft = '00000000-0000-4000-8000-000000000010';
const live = '00000000-0000-4000-8000-000000000020';
const legacy = '00000000-0000-4000-8000-000000000030';
const mockQuery = jest.fn();
const mockAuth = jest.fn();
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(`facility_id=${facility}`), useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => ({ auth: { getUser: mockAuth }, from: mockQuery }) }));

let menus: Record<string, unknown>[];
let mutation: (url: string, options: RequestInit) => Promise<unknown>;
function snapshot() {
  return { menus, revision: '2026-10-22T01:00:00.000Z' };
}
function mutations() {
  return (global.fetch as jest.Mock).mock.calls.filter(([, options]) => options?.method);
}
function reads() {
  return (global.fetch as jest.Mock).mock.calls.filter(([, options]) => !options?.method);
}

beforeEach(() => {
  jest.clearAllMocks();
  menus = [
    { id: draft, facility_id: facility, name: 'HPBカット', category: 'カット', sort_order: 0, price: 4000, is_published: false, is_featured: false },
    { id: live, facility_id: facility, name: '公開カラー', category: 'カラー', sort_order: 0, price: 6000, is_published: true, is_featured: false },
    { id: legacy, facility_id: facility, name: '旧データ', category: 'その他', sort_order: 0, price: 1000, is_published: null, is_featured: false },
  ];
  mockAuth.mockResolvedValue({ data: { user: { id: 'synthetic-user' } }, error: null });
  mockQuery.mockImplementation(() => {
    const q: Record<string, unknown> = {};
    for (const method of ['select', 'in', 'limit', 'eq', 'order']) q[method] = jest.fn(() => q);
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [{ facility_id: facility, facility_profiles: { name: '合成店舗' } }], error: null }).then(resolve);
    return q;
  });
  mutation = async () => ({ ok: true, json: async () => ({ menu: {} }) });
  global.fetch = jest.fn().mockImplementation((url: string, options?: RequestInit) => {
    if (options?.method) return mutation(url, options);
    return Promise.resolve({ ok: true, json: async () => snapshot() });
  });
});

test('非公開のメニューにだけ「非公開」を表示し、件数と公開の手順を知らせる', async () => {
  render(<Page />);
  await screen.findByText('HPBカット');
  expect(screen.getAllByText('非公開')).toHaveLength(1);
  expect(screen.getByText(/非公開のメニューが1件あります/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'HPBカットを公開する' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '公開カラーを非公開にする' })).toBeTruthy();
  // is_published が null の旧データは公開扱い（公開側の可視条件と同じ）。
  expect(screen.getByRole('button', { name: '旧データを非公開にする' })).toBeTruthy();
});

test('公開を押すと is_published だけを選択中の店舗へ送り、一覧を読み直す', async () => {
  render(<Page />);
  await screen.findByText('HPBカット');
  mutation = async () => {
    menus = menus.map((menu) => (menu.id === draft ? { ...menu, is_published: true } : menu));
    return { ok: true, json: async () => ({ menu: {} }) };
  };
  fireEvent.click(screen.getByRole('button', { name: 'HPBカットを公開する' }));
  await screen.findByText('公開しました');
  expect(mutations()).toHaveLength(1);
  expect(mutations()[0][0]).toBe(`/api/admin/menus/${draft}?facility_id=${facility}`);
  expect(mutations()[0][1].method).toBe('PATCH');
  expect(JSON.parse(mutations()[0][1].body)).toEqual({ is_published: true });
  await waitFor(() => expect(screen.queryByText('非公開')).toBeNull());
  expect(screen.queryByText(/非公開のメニューが/)).toBeNull();
  expect(reads()).toHaveLength(2);
});

test('公開中のメニューは非公開にできる', async () => {
  render(<Page />);
  await screen.findByText('公開カラー');
  fireEvent.click(screen.getByRole('button', { name: '公開カラーを非公開にする' }));
  await screen.findByText('非公開にしました');
  expect(JSON.parse(mutations()[0][1].body)).toEqual({ is_published: false });
});

test('拒否されたらサーバーの理由を表示し、成功扱いにしない', async () => {
  render(<Page />);
  await screen.findByText('HPBカット');
  mutation = async () => ({ ok: false, json: async () => ({ error: '店舗の管理権限を確認してください' }) });
  fireEvent.click(screen.getByRole('button', { name: 'HPBカットを公開する' }));
  await screen.findByText('店舗の管理権限を確認してください');
  expect(screen.queryByText('公開しました')).toBeNull();
  expect(reads()).toHaveLength(1);
});

test('理由の無い拒否は既定の文言を出す', async () => {
  render(<Page />);
  await screen.findByText('HPBカット');
  mutation = async () => ({ ok: false, json: async () => { throw new Error('not json'); } });
  fireEvent.click(screen.getByRole('button', { name: 'HPBカットを公開する' }));
  await screen.findByText('公開設定を変更できませんでした');
});

test('応答が失われたら一覧を読み直して実際の状態を表示する', async () => {
  render(<Page />);
  await screen.findByText('HPBカット');
  mutation = () => Promise.reject(new Error('network'));
  fireEvent.click(screen.getByRole('button', { name: 'HPBカットを公開する' }));
  await screen.findByText('公開設定を変更できませんでした');
  await waitFor(() => expect(reads()).toHaveLength(2));
  expect(mutations()).toHaveLength(1);
});

// HPB 一括反映の下書き（数十件）を 1 件ずつ公開するとレート制限に当たる。まとめて公開する導線を固定する。
test('非公開のメニューがあれば「すべて公開する」で 1 回だけ一括公開し、件数を知らせて一覧を読み直す', async () => {
  render(<Page />);
  await screen.findByText('HPBカット');
  mutation = async () => {
    menus = menus.map((menu) => (menu.is_published === false ? { ...menu, is_published: true } : menu));
    return { ok: true, json: async () => ({ published: 1 }) };
  };
  fireEvent.click(screen.getByRole('button', { name: '非公開のメニューをすべて公開する' }));
  await screen.findByText('1件のメニューを公開しました');
  expect(mutations()).toHaveLength(1);
  expect(mutations()[0][0]).toBe(`/api/admin/menus/publish?facility_id=${facility}`);
  expect(mutations()[0][1].method).toBe('POST');
  await waitFor(() => expect(screen.queryByText(/非公開のメニューが/)).toBeNull());
  expect(screen.queryByRole('button', { name: '非公開のメニューをすべて公開する' })).toBeNull();
  expect(reads()).toHaveLength(2);
});

test('非公開のメニューが無ければ一括公開のボタンを出さない', async () => {
  menus = menus.filter((menu) => menu.is_published !== false);
  render(<Page />);
  await screen.findByText('公開カラー');
  expect(screen.queryByRole('button', { name: '非公開のメニューをすべて公開する' })).toBeNull();
});

test('一括公開が拒否されたらサーバーの理由を表示し、一覧は読み直さない', async () => {
  render(<Page />);
  await screen.findByText('HPBカット');
  mutation = async () => ({ ok: false, json: async () => ({ error: 'リクエストが多すぎます' }) });
  fireEvent.click(screen.getByRole('button', { name: '非公開のメニューをすべて公開する' }));
  await screen.findByText('リクエストが多すぎます');
  expect(reads()).toHaveLength(1);
});

test('一括公開の理由の無い拒否・件数の無い応答は既定の文言を出す', async () => {
  render(<Page />);
  await screen.findByText('HPBカット');
  mutation = async () => ({ ok: false, json: async () => { throw new Error('not json'); } });
  fireEvent.click(screen.getByRole('button', { name: '非公開のメニューをすべて公開する' }));
  await screen.findByText('公開できませんでした');
  mutation = async () => ({ ok: true, json: async () => ({}) });
  fireEvent.click(screen.getByRole('button', { name: '非公開のメニューをすべて公開する' }));
  await screen.findByText('公開しました');
});

test('一括公開の応答が失われたら一覧を読み直して実際の状態を表示する', async () => {
  render(<Page />);
  await screen.findByText('HPBカット');
  mutation = () => Promise.reject(new Error('network'));
  fireEvent.click(screen.getByRole('button', { name: '非公開のメニューをすべて公開する' }));
  await screen.findByText('公開できませんでした');
  await waitFor(() => expect(reads()).toHaveLength(2));
});

test('公開中の最後のメニューを非公開にできないときは、その理由を表示する', async () => {
  render(<Page />);
  await screen.findByText('公開カラー');
  mutation = async () => ({ ok: false, json: async () => ({ error: '公開中は最後の公開メニューを非公開にできません。先に別のメニューを公開するか、施設を非公開にしてください。' }) });
  fireEvent.click(screen.getByRole('button', { name: '公開カラーを非公開にする' }));
  await screen.findByText(/最後の公開メニューを非公開にできません/);
  expect(screen.queryByText('非公開にしました')).toBeNull();
});
