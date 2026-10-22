import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Page from '../page';

// メニューの追加・編集フォーム（2026年10月23日）。
// - 所要時間が空欄・0 のまま保存でき、予約枠ではオーナーの知らない既定の長さで押さえられていた。
// - 写真は Supabase Storage の URL を貼り付ける欄しか無く、ヘルプの「写真もアップロード可能」と食い違っていた。
// - メニューが無い店舗から HPB 取り込みへ行く導線が無かった（ナビにも出ていなかった）。
const facility = '00000000-0000-4000-8000-000000000002';
const mockQuery = jest.fn();
const mockAuth = jest.fn();
const mockUpload = jest.fn();
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(`facility_id=${facility}`), useRouter: () => ({ push: jest.fn() }) }));
jest.mock('next/image', () => ({ __esModule: true, default: (props: { alt: string; src: string }) => <span data-src={props.src}>{props.alt}</span> }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => ({
  auth: { getUser: mockAuth },
  from: mockQuery,
  storage: { from: (bucket: string) => ({
    upload: (path: string, file: File) => mockUpload(bucket, path, file),
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example.invalid/${bucket}/${path}` } }),
  }) },
}) }));

let menus: Record<string, unknown>[];
const mutations = () => (global.fetch as jest.Mock).mock.calls.filter(([, options]) => options?.method);

beforeEach(() => {
  jest.clearAllMocks();
  menus = [];
  mockUpload.mockResolvedValue({ error: null });
  mockAuth.mockResolvedValue({ data: { user: { id: 'synthetic-user' } }, error: null });
  mockQuery.mockImplementation(() => {
    const q: Record<string, unknown> = {};
    for (const method of ['select', 'in', 'limit', 'eq', 'order']) q[method] = jest.fn(() => q);
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [{ facility_id: facility, facility_profiles: { name: '合成店舗' } }], error: null }).then(resolve);
    return q;
  });
  global.fetch = jest.fn().mockImplementation((_url: string, options?: RequestInit) => {
    if (options?.method) return Promise.resolve({ ok: true, json: async () => ({ menu: {} }) });
    return Promise.resolve({ ok: true, json: async () => ({ menus, revision: null }) });
  });
});

async function openNewMenu() {
  render(<Page />);
  fireEvent.click(await screen.findByRole('button', { name: 'メニュー追加' }));
  fireEvent.change(screen.getByLabelText(/メニュー名/), { target: { value: '合成カット' } });
}

test.each(['', '0', '10', '481', '30.5'])('所要時間 %p は保存させない（15〜480分）', async (value) => {
  await openNewMenu();
  fireEvent.change(screen.getByLabelText(/所要時間/), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByText('所要時間は15〜480分の整数で入力してください');
  expect(mutations()).toHaveLength(0);
});

test.each([['15', 15], ['480', 480]])('所要時間 %p 分は保存する', async (value, minutes) => {
  await openNewMenu();
  fireEvent.change(screen.getByLabelText(/所要時間/), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(mutations()).toHaveLength(1));
  expect(JSON.parse(mutations()[0][1].body).duration_minutes).toBe(minutes);
});

test('写真はファイルを選んでアップロードし、その公開 URL を保存する（URL を貼らせない）', async () => {
  await openNewMenu();
  expect(screen.queryByText('画像URL')).toBeNull();
  const file = new File(['x'], 'menu.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('メニューの写真を選ぶ'), { target: { files: [file] } });
  await screen.findByRole('button', { name: '写真を外す' });
  const [bucket, path] = mockUpload.mock.calls[0];
  expect(bucket).toBe('photos');
  // 写真管理と同じく、店舗のフォルダの下に置く（Storage の書き込み権限はこのフォルダ単位）
  expect(path).toMatch(new RegExp(`^facilities/${facility}/menus/\\d+\\.png$`));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(mutations()).toHaveLength(1));
  expect(JSON.parse(mutations()[0][1].body).photo_url).toBe(`https://storage.example.invalid/photos/${path}`);
});

test('写真を外すと保存時に写真を消す', async () => {
  await openNewMenu();
  fireEvent.change(screen.getByLabelText('メニューの写真を選ぶ'), { target: { files: [new File(['x'], 'm.jpg', { type: 'image/jpeg' })] } });
  fireEvent.click(await screen.findByRole('button', { name: '写真を外す' }));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(mutations()).toHaveLength(1));
  expect(JSON.parse(mutations()[0][1].body).photo_url).toBeNull();
});

test.each([
  [new File(['x'], 'a.gif', { type: 'image/gif' }), 'JPG, PNG, WebPのみ対応しています'],
  [new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }), 'ファイルサイズは5MB以下にしてください'],
])('対応していない写真はアップロードしない：%#', async (file, message) => {
  await openNewMenu();
  fireEvent.change(screen.getByLabelText('メニューの写真を選ぶ'), { target: { files: [file] } });
  await screen.findByText(message);
  expect(mockUpload).not.toHaveBeenCalled();
});

test('アップロードに失敗したら伝える', async () => {
  mockUpload.mockResolvedValue({ error: { message: 'synthetic' } });
  await openNewMenu();
  fireEvent.change(screen.getByLabelText('メニューの写真を選ぶ'), { target: { files: [new File(['x'], 'm.webp', { type: 'image/webp' })] } });
  await screen.findByText('写真をアップロードできませんでした');
  expect(screen.queryByRole('button', { name: '写真を外す' })).toBeNull();
});

test('メニューが無い店舗には HPB からの取り込みを案内する', async () => {
  render(<Page />);
  const link = await screen.findByRole('link', { name: '掲載中のメニューを取り込めます' });
  expect(link.getAttribute('href')).toBe(`/admin/hpb-menus?facility_id=${facility}`);
});
