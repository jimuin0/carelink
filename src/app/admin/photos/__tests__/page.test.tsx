import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminPhotosPage from '../page';

const first = '71000000-0000-4000-8000-000000000001';
const second = '71000000-0000-4000-8000-000000000002';
const photoId = '71000000-0000-4000-8000-000000000003';
const uploadedId = '71000000-0000-4000-8000-000000000004';
const mockInsert = jest.fn();
let mockRequested: string | null = second;
let mockProfileRead = jest.fn();
// 店舗の現在のメイン写真。既定は一覧に無い別の写真（＝メインは設定済み）。
let mockMainPhoto: string | null = 'https://example.invalid/other-main.png';
let mockMainError: unknown = null;
const mockPhotoFilters = jest.fn();
const mockFetch = jest.fn();
const mockDb = jest.fn();
const mockCompress = jest.fn();
let mockBusinessType: string | null = 'ヘアサロン';
let mockUser: { id: string } | null = { id: 'synthetic-user' };
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), useSearchParams: () => ({ get: () => mockRequested }) }));
jest.mock('next/image', () => ({ __esModule: true, default: (props: { alt: string }) => <span>{props.alt}</span> }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => mockDb() }));
jest.mock('@/components/Toast', () => ({ __esModule: true, default: ({ message }: { message: string }) => <p role="status">{message}</p> }));
jest.mock('@/lib/image-compress', () => ({ compressImage: (file: File) => mockCompress(file) }));
jest.mock('@/components/ConfirmDialog', () => ({ __esModule: true, default: ({ open, onConfirm, confirmLabel }: { open: boolean; onConfirm: () => void; confirmLabel: string }) => open ? <button onClick={onConfirm}>{confirmLabel}</button> : null }));

beforeEach(() => {
  jest.clearAllMocks();
  mockRequested = second;
  mockProfileRead = jest.fn();
  mockMainPhoto = 'https://example.invalid/other-main.png';
  mockMainError = null;
  mockBusinessType = 'ヘアサロン';
  mockUser = { id: 'synthetic-user' };
  mockCompress.mockImplementation(async (file: File) => file);
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, photoId }) });
  global.fetch = mockFetch;
  mockInsert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: uploadedId }, error: null }) }) });
  mockDb.mockReturnValue({
    storage: { from: () => ({ upload: async () => ({ error: null }),
      getPublicUrl: () => ({ data: { publicUrl: 'https://example.invalid/uploaded.png' } }) }) },
    auth: { getUser: async () => ({ data: { user: mockUser }, error: null }) },
    from: (table: string) => {
      if (table === 'facility_members') {
        const chain = { select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
          limit: async () => ({ data: [{ facility_id: first, facility_profiles: { name: '合成店舗A' } },
            { facility_id: second, facility_profiles: { name: '合成店舗B' } }], error: null }) };
        return chain;
      }
      if (table === 'facility_profiles') {
        // 読むのはメイン写真の URL と業種（医療広告の注意の出し分け）だけ。
        // 書き込みはサーバー経由（ブラウザから facility_profiles を書かない）。
        const forbid = () => { mockProfileRead(); throw new Error('browser profile writes forbidden'); };
        const profile = { select: (columns: string) => { if (columns !== 'main_photo_url, business_type') forbid(); return profile; },
          eq: () => profile, maybeSingle: async () => ({ data: mockMainError ? null : { main_photo_url: mockMainPhoto, business_type: mockBusinessType }, error: mockMainError }),
          update: forbid, insert: forbid, upsert: forbid };
        return profile;
      }
      const chain = { select: () => chain, eq: (key: string, value: string) => { mockPhotoFilters(key, value); return chain; },
        order: () => chain, limit: async () => ({ error: null, data: [{ id: photoId, facility_id: second,
          photo_type: 'main', photo_url: 'https://example.invalid/synthetic.png', caption: '合成写真', sort_order: 0 }] }),
        insert: (row: unknown) => mockInsert(row),
        delete: () => { throw new Error('Direct browser photo deletion forbidden'); } };
      return chain;
    },
  });
});

test('複数店舗は明示選択まで写真を読まず、指定店舗だけを編集する', async () => {
  mockRequested = null;
  const { rerender } = render(<AdminPhotosPage />);
  await screen.findByText('編集する店舗を選択してください');
  expect(mockPhotoFilters).not.toHaveBeenCalled();
  mockRequested = second;
  rerender(<AdminPhotosPage />);
  await screen.findByRole('button', { name: 'メインに設定' });
  expect(mockPhotoFilters).toHaveBeenCalledWith('facility_id', second);
  expect(mockPhotoFilters).not.toHaveBeenCalledWith('facility_id', first);
});

test.each(['success', 'business-failure', 'http-failure', 'invalid-json', 'reject'])('メイン写真はserver経由で結果確認する：%s', async mode => {
  if (mode === 'reject') mockFetch.mockRejectedValue(new Error('synthetic failure'));
  else mockFetch.mockResolvedValue({ ok: mode !== 'http-failure', json: async () => {
    if (mode === 'invalid-json') throw new Error('synthetic invalid JSON');
    return { ok: mode === 'success' };
  } });
  render(<AdminPhotosPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'メインに設定' }));
  await screen.findByText(mode === 'success' ? 'メイン写真を設定しました' : '設定を確認できませんでした。再読み込みして確認してください');
  expect(mockFetch).toHaveBeenCalledWith(`/api/admin/settings?facility_id=${second}&action=main-photo`, expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ photoId }) }));
  expect(mockProfileRead).not.toHaveBeenCalled();
});

test.each(['success', 'business-failure', 'wrong-id', 'http-failure', 'invalid-json', 'reject'])('写真削除はserverの確定結果まで成功表示しない：%s', async mode => {
  if (mode === 'reject') mockFetch.mockRejectedValue(new Error('synthetic failure'));
  else mockFetch.mockResolvedValue({ ok: mode !== 'http-failure', json: async () => {
    if (mode === 'invalid-json') throw new Error('synthetic malformed JSON');
    return { ok: mode !== 'business-failure', photoId: mode === 'wrong-id' ? first : photoId };
  } });
  render(<AdminPhotosPage />);
  fireEvent.click(await screen.findByRole('button', { name: '掲載から外す' }));
  fireEvent.click(screen.getAllByRole('button', { name: '掲載から外す' })[1]);
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(mode === 'success' ? '掲載写真を外しました' : '削除を確認できませんでした。再読み込みして確認してください'));
  expect(mockFetch).toHaveBeenCalledWith(`/api/admin/photos/${photoId}?facility_id=${second}`, { method: 'DELETE' });
  expect(mockPhotoFilters).not.toHaveBeenCalledWith('id', photoId);
  expect(mockPhotoFilters).toHaveBeenCalledWith('facility_id', second);
});

function uploadAs(type: string) {
  fireEvent.change(screen.getByLabelText('種類'), { target: { value: type } });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], 'synthetic.jpg', { type: 'image/jpeg' })] } });
}

test.each([
  ['success', '1枚アップロードし、メイン写真に設定しました'],
  ['business-failure', '1枚アップロードしましたが、メイン写真に設定できませんでした。「メインに設定」を押してください'],
  ['reject', '1枚アップロードしましたが、メイン写真に設定できませんでした。「メインに設定」を押してください'],
])('種類「メイン」で上げた写真は検索カードの画像にも設定する：%s', async (mode, message) => {
  if (mode === 'reject') mockFetch.mockRejectedValue(new Error('synthetic failure'));
  else mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: mode === 'success' }) });
  render(<AdminPhotosPage />);
  await screen.findByRole('button', { name: 'メインに設定' });
  uploadAs('main');
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(message));
  expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ facility_id: second, photo_type: 'main' }));
  expect(mockFetch).toHaveBeenCalledWith(`/api/admin/settings?facility_id=${second}&action=main-photo`, expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ photoId: uploadedId }) }));
  expect(mockProfileRead).not.toHaveBeenCalled();
});

test('メイン以外の種類では検索カードの画像を変えない', async () => {
  render(<AdminPhotosPage />);
  await screen.findByRole('button', { name: 'メインに設定' });
  uploadAs('interior');
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('1枚アップロードしました'));
  expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ photo_type: 'interior' }));
  expect(mockFetch).not.toHaveBeenCalled();
});

test('登録結果を確認できない写真はメインに設定しない', async () => {
  mockInsert.mockReturnValue({ select: () => ({ single: async () => ({ data: null, error: null }) }) });
  render(<AdminPhotosPage />);
  await screen.findByRole('button', { name: 'メインに設定' });
  uploadAs('main');
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('アップロードに失敗しました'));
  expect(mockFetch).not.toHaveBeenCalled();
});

test('一部の失敗とメイン設定の失敗を両方伝える', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: false }) });
  mockInsert
    .mockReturnValueOnce({ select: () => ({ single: async () => ({ data: { id: uploadedId }, error: null }) }) })
    .mockReturnValueOnce({ select: () => ({ single: async () => ({ data: null, error: new Error('synthetic insert failure') }) }) });
  render(<AdminPhotosPage />);
  await screen.findByRole('button', { name: 'メインに設定' });
  fireEvent.change(screen.getByLabelText('種類'), { target: { value: 'main' } });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' }), new File(['y'], 'b.jpg', { type: 'image/jpeg' })] } });
  await waitFor(() => expect(screen.getByRole('status').textContent)
    .toBe('1枚成功・1枚失敗しました。また、メイン写真に設定できませんでした。「メインに設定」を押してください'));
});

// ─── メイン写真が無い店舗（2026年10月23日） ─────────────────────────────────────
// 種類「メイン」を選ばずに上げると main_photo_url が設定されず、検索カードは「予約OK」なのに「写真未登録」だった。
test('メイン写真が無い店舗では、種類に関係なく最初の1枚をメインにする', async () => {
  mockMainPhoto = null;
  render(<AdminPhotosPage />);
  await screen.findByRole('button', { name: 'メインに設定' });
  uploadAs('interior');
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('1枚アップロードし、1枚目をメイン写真に設定しました'));
  expect(mockFetch).toHaveBeenCalledWith(`/api/admin/settings?facility_id=${second}&action=main-photo`, expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ photoId: uploadedId }) }));
  expect(mockProfileRead).not.toHaveBeenCalled();
});

test('メイン写真の有無を読めなければ、推測でメインを差し替えない', async () => {
  mockMainError = { message: 'synthetic' };
  render(<AdminPhotosPage />);
  await screen.findByRole('button', { name: 'メインに設定' });
  uploadAs('interior');
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('1枚アップロードしました'));
  expect(mockFetch).not.toHaveBeenCalled();
});

test('現在のメイン写真に「現在のメイン」と表示し、その写真の「メインに設定」は押せない', async () => {
  mockMainPhoto = 'https://example.invalid/synthetic.png';
  render(<AdminPhotosPage />);
  expect(await screen.findByText('現在のメイン')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'メインに設定' }) as HTMLButtonElement).disabled).toBe(true);
});

test('「メインに設定」が成功したら、その写真に「現在のメイン」を出す', async () => {
  render(<AdminPhotosPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'メインに設定' }));
  expect(await screen.findByText('現在のメイン')).toBeTruthy();
});

// ─── 1 枚ずつの判定（2026年10月23日） ─────────────────────────────────────────
// 以前は 1 枚でも 5MB を超えると選んだ全部を断り、どの写真かも言わなかった。
function sized(name: string, type: string, bytes: number) {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}

test('大きすぎる・形式の違う写真だけを断り、名前と理由を一覧に残す。ほかの写真は上げる', async () => {
  const big = 6 * 1024 * 1024;
  // 縮小で 5MB 以下に収まる写真は上げ、収まらない写真は断る。
  mockCompress.mockImplementation(async (file: File) => file.name === 'shrinks.jpg' ? sized('shrinks.jpg', 'image/jpeg', 1024) : file);
  render(<AdminPhotosPage />);
  await screen.findByRole('button', { name: 'メインに設定' });
  fireEvent.change(screen.getByLabelText('種類'), { target: { value: 'interior' } });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [
    sized('ok.jpg', 'image/jpeg', 1024), sized('huge.jpg', 'image/jpeg', big), sized('shrinks.jpg', 'image/jpeg', big), sized('scan.heic', 'image/heic', 1024),
  ] } });
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('2枚アップロードしました'));
  expect(mockInsert).toHaveBeenCalledTimes(2);
  const alert = screen.getByRole('alert');
  expect(alert.textContent).toContain('次の写真はアップロードしませんでした');
  expect(alert.textContent).toContain('huge.jpg（5MBを超え、縮小しても収まりませんでした）');
  expect(alert.textContent).toContain('scan.heic（JPG・PNG・WebP以外の形式）');
  expect(alert.textContent).not.toContain('ok.jpg');
  expect(alert.textContent).not.toContain('shrinks.jpg');
  expect(mockCompress).toHaveBeenCalledTimes(2);
});

test('上げられる写真が1枚も無ければ、アップロードせず理由だけを出す', async () => {
  render(<AdminPhotosPage />);
  await screen.findByRole('button', { name: 'メインに設定' });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [sized('huge.png', 'image/png', 6 * 1024 * 1024)] } });
  expect((await screen.findByRole('alert')).textContent).toContain('huge.png（5MBを超え、縮小しても収まりませんでした）');
  expect(mockInsert).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
  expect(screen.queryByRole('alert')).toBeNull();
});

// ─── 医療広告の注意は対象の業種だけ（2026年10月23日） ─────────────────────────────
test.each([
  ['ヘアサロン', false],
  ['ピラティス', false],
  ['鍼灸院・整骨院', true],
  ['美容クリニック', true],
  [null, true],
])('業種 %p の店舗に医療広告の注意を出すか：%p', async (type, shown) => {
  mockBusinessType = type;
  render(<AdminPhotosPage />);
  await screen.findByRole('button', { name: 'メインに設定' });
  expect(screen.queryByText('⚠️ 医療広告ガイドラインについて') !== null).toBe(shown);
});

test('業種を読めなければ、医療広告の注意は出す側に倒す', async () => {
  mockMainError = { message: 'synthetic' };
  render(<AdminPhotosPage />);
  await screen.findByRole('button', { name: 'メインに設定' });
  expect(screen.getByText('⚠️ 医療広告ガイドラインについて')).toBeTruthy();
});

// ─── ログイン切れ（2026年10月23日） ───────────────────────────────────────────
// 以前は「管理できる店舗がありません」と出て、店舗が消えたのかと誤解させていた。
test('ログインが切れていたら、店舗が無いとは言わずにログインし直す案内を出す', async () => {
  mockUser = null;
  render(<AdminPhotosPage />);
  expect((await screen.findByRole('alert')).textContent).toContain('セッションが切れました。再ログインしてください。');
  expect(screen.queryByText('管理できる店舗がありません。')).toBeNull();
  expect(screen.getByRole('link', { name: 'ログインし直す' }).getAttribute('href'))
    .toBe(`/auth/login?redirect=${encodeURIComponent(`/admin/photos?facility_id=${second}`)}`);
  expect(mockPhotoFilters).not.toHaveBeenCalled();
});

test.each(['delete', 'main'])('操作中に 401 が返ったらログインし直す案内に切り替える：%s', async (action) => {
  mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) });
  render(<AdminPhotosPage />);
  if (action === 'delete') {
    fireEvent.click(await screen.findByRole('button', { name: '掲載から外す' }));
    fireEvent.click(screen.getAllByRole('button', { name: '掲載から外す' })[1]);
  } else {
    fireEvent.click(await screen.findByRole('button', { name: 'メインに設定' }));
  }
  expect((await screen.findByRole('alert')).textContent).toContain('セッションが切れました。再ログインしてください。');
});

test('種類「メイン」で上げた直後のメイン設定が 401 なら、ログインし直す案内に切り替える', async () => {
  mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
  render(<AdminPhotosPage />);
  await screen.findByRole('button', { name: 'メインに設定' });
  uploadAs('main');
  expect((await screen.findByRole('alert')).textContent).toContain('セッションが切れました。再ログインしてください。');
});
