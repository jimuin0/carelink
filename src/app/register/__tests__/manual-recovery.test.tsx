/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RegisterForm from '@/components/register/RegisterForm';
import { SALON_BROWSER_CONTEXT_KEY } from '@/lib/salon-browser-context';
const mockRouter = { push: jest.fn() };
const mockExport = jest.fn(); const mockImport = jest.fn(); const mockLegacyUpload = jest.fn(); const mockSignedUpload = jest.fn(); const mockCaptcha = jest.fn();
const mockReadLocal = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/salon-draft-backup', () => ({ exportSalonDraftBackup: (...args: unknown[]) => mockExport(...args), importSalonDraftBackup: (...args: unknown[]) => mockImport(...args) }));
jest.mock('@/lib/salon-local-draft', () => ({ ...jest.requireActual('@/lib/salon-local-draft'), readLocalSalonDraft: () => mockReadLocal() }));
jest.mock('@/lib/recaptcha-client', () => ({ getRecaptchaToken: () => mockCaptcha() }));
jest.mock('@/lib/image-compress', () => ({ compressImage: async (file: File) => file }));
jest.mock('@/lib/supabase', () => ({ supabase: { storage: { from: () => ({ upload: mockLegacyUpload, uploadToSignedUrl: mockSignedUpload, remove: jest.fn(), getPublicUrl: () => ({ data: { publicUrl: 'https://fixture.invalid/original.png' } }) }) } } }));
const intentId = '11111111-1111-4111-8111-111111111111';
const draftFile = new File(['fixture-backup'], 'carelink-draft.json', { type: 'application/json' });
const fields = [[/^施設名/, '合成施設'], [/^業種/, 'ヘアサロン'], [/^代表者名/, '合成代表'], [/^担当者名/, '合成担当'], [/^メールアドレス/, 'fixture@example.invalid'], [/^電話番号/, '09012345678']] as const;
const validValues = { facility_name: '復元施設', business_type: 'ヘアサロン', representative_name: '復元代表', contact_name: '復元担当', email: 'restore@example.invalid', phone: '090-1234-5678', contact_phone: '', website: '', postal_code: '', address: '合成住所', prefecture: null, city: null, building_name: '', nearest_station: '', business_hours: '', regular_holiday: '', seat_count: null, staff_count: null, has_parking: false, features: [], pr_text: '復元PR', desired_start_date: '' };
const response = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;
let request: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks(); sessionStorage.clear(); request = jest.fn(); global.fetch = request;
  mockReadLocal.mockResolvedValue(null);
  mockExport.mockResolvedValue(new Blob(['backup'], { type: 'application/json' })); mockCaptcha.mockResolvedValue('fresh-captcha');
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: jest.fn(() => 'blob:fixture') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() });
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: () => new AbortController().signal });
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => '44444444-4444-4444-8444-444444444444' });
});
afterEach(() => { jest.restoreAllMocks(); });
async function mount(v2Enabled = false) {
  const mounted = render(<RegisterForm v2Enabled={v2Enabled} />);
  await waitFor(() => expect(screen.getByLabelText(/^施設名/)).toBeEnabled()); return mounted;
}
async function toLastStep() {
  fireEvent.click(screen.getByRole('button', { name: '次へ' })); await screen.findByLabelText(/^郵便番号/);
  fireEvent.click(screen.getByRole('button', { name: '次へ' })); await screen.findByRole('button', { name: '登録する' });
}
async function fill() {
  await mount(); for (const [label, value] of fields) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  await toLastStep(); screen.getAllByRole('checkbox').forEach(box => fireEvent.click(box));
}
async function submit() {
  fireEvent.click(screen.getByRole('button', { name: '登録する' })); const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '送信する' }));
}
const download = () => screen.getByRole('button', { name: '入力と元の写真をバックアップ' });
const restore = () => screen.getByLabelText('バックアップから入力を復元');

test('manual backup contains current values and the original sparse files, never auto POST/persistence', async () => {
  await fill(); const first = new File(['first-original'], 'first.png', { type: 'image/png', lastModified: 1 });
  const seventh = new File(['seventh-original'], 'seventh.webp', { type: 'image/webp', lastModified: 7 });
  fireEvent.change(screen.getByLabelText('外観の写真を選択'), { target: { files: [first] } });
  fireEvent.change(screen.getByLabelText('メニュー 3の写真を選択'), { target: { files: [seventh] } });
  expect(mockExport).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
  fireEvent.click(download()); await screen.findByText(/バックアップファイルを作成しました/);
  expect(mockExport).toHaveBeenCalledWith(expect.objectContaining({ facility_name: '合成施設' }), [first, null, null, null, null, null, seventh]);
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fixture'), { timeout: 2000 });
  expect(request).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
});
test.each(['serialization', 'download'])('%s failure leaves typed values/photos mounted and never POSTs', async failure => {
  await fill(); const original = new File(['original'], 'original.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('外観の写真を選択'), { target: { files: [original] } });
  if (failure === 'serialization') mockExport.mockRejectedValue(new Error('quota exceeded'));
  else (URL.createObjectURL as jest.Mock).mockImplementation(() => { throw new Error('download unavailable'); });
  fireEvent.click(download()); await screen.findByText('バックアップを保存できませんでした。入力と元の写真はこの画面に保持されています。');
  expect(await screen.findByAltText('外観')).toBeVisible(); expect(request).not.toHaveBeenCalled();
  expect(mockExport.mock.calls[0][0].facility_name).toBe('合成施設'); expect(mockExport.mock.calls[0][1][0]).toBe(original);
  expect(download()).toBeEnabled();
});
test('verified import restores full originals/order atomically, resets both consent checks and requires unsent review', async () => {
  await fill(); const first = new File(['first-original'], 'first.png', { type: 'image/png', lastModified: 2 });
  const last = new File(['last-original'], 'last.gif', { type: 'image/gif', lastModified: 9 });
  mockImport.mockResolvedValue({ values: validValues, photos: [first, null, null, null, null, null, last] });
  fireEvent.change(restore(), { target: { files: [draftFile] } }); await screen.findByText(/入力と元の写真を復元しました/);
  expect(screen.getByLabelText(/^施設名/)).toHaveValue('復元施設'); expect(screen.getByLabelText(/^メールアドレス/)).toHaveValue('restore@example.invalid');
  await toLastStep(); expect(await screen.findByAltText('外観')).toBeVisible(); expect(await screen.findByAltText('メニュー 3')).toBeVisible();
  expect(screen.getAllByRole('checkbox').every(box => !(box as HTMLInputElement).checked)).toBe(true);
  expect(screen.getByRole('button', { name: '登録する' })).toBeDisabled();
  const checks = screen.getAllByRole('checkbox'); fireEvent.click(checks[1]); fireEvent.click(checks[2]);
  expect(screen.getByRole('button', { name: '登録する' })).toBeDisabled(); fireEvent.click(checks[0]);
  expect(screen.getByRole('button', { name: '登録する' })).toBeEnabled();
  fireEvent.click(download()); await screen.findByText(/バックアップファイルを作成しました/);
  expect(mockExport).toHaveBeenLastCalledWith(expect.objectContaining({ facility_name: '復元施設', pr_text: '復元PR' }), [first, null, null, null, null, null, last]);
  expect(request).not.toHaveBeenCalled(); expect(mockCaptcha).not.toHaveBeenCalled();
});
test('invalid import does not replace any current field, file, or consent', async () => {
  await fill(); const original = new File(['original'], 'original.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('外観の写真を選択'), { target: { files: [original] } }); mockImport.mockRejectedValue(new Error('bad SHA'));
  fireEvent.change(restore(), { target: { files: [draftFile] } }); await screen.findByText(/下書きを復元できませんでした/);
  expect(await screen.findByAltText('外観')).toBeVisible(); expect(screen.getAllByRole('checkbox').every(box => (box as HTMLInputElement).checked)).toBe(true);
  fireEvent.click(download()); await screen.findByText(/バックアップファイルを作成しました/);
  expect(mockExport).toHaveBeenLastCalledWith(expect.objectContaining({ facility_name: '合成施設' }), [original, null, null, null, null, null, null]); expect(request).not.toHaveBeenCalled();
});
test.each(['prepared', 'attempted', 'confirmed'])('existing %s context cannot be replaced by import even if introduced after mounting', async phase => {
  await mount(); fireEvent.change(screen.getByLabelText(/^施設名/), { target: { value: '既存の入力' } });
  const current = JSON.stringify({ version: 1, intentId, phase }); sessionStorage.setItem(SALON_BROWSER_CONTEXT_KEY, current);
  fireEvent.change(restore(), { target: { files: [draftFile] } }); await screen.findByText(/既存の申込または送信状況を確認するまで復元できません/);
  expect(mockImport).not.toHaveBeenCalled(); expect(screen.getByLabelText(/^施設名/)).toHaveValue('既存の入力');
  expect(sessionStorage.getItem(SALON_BROWSER_CONTEXT_KEY)).toBe(current); expect(request).not.toHaveBeenCalled();
  expect(restore()).toBeDisabled();
  if (phase === 'prepared') expect(download()).toBeEnabled(); else expect(download()).toBeDisabled();
});
test('context changed while decoding prevents partial restore', async () => {
  await mount(); fireEvent.change(screen.getByLabelText(/^施設名/), { target: { value: '既存の入力' } });
  let resolveImport: (value: unknown) => void = () => undefined; mockImport.mockImplementation(() => new Promise(resolve => { resolveImport = resolve; }));
  fireEvent.change(restore(), { target: { files: [draftFile] } }); await waitFor(() => expect(mockImport).toHaveBeenCalledTimes(1));
  sessionStorage.setItem(SALON_BROWSER_CONTEXT_KEY, JSON.stringify({ version: 1, intentId, phase: 'attempted' }));
  await act(async () => { resolveImport({ values: validValues, photos: Array(7).fill(null) }); });
  await screen.findByText(/下書きを復元できませんでした/); expect(screen.getByLabelText(/^施設名/)).toHaveValue('既存の入力'); expect(request).not.toHaveBeenCalled();
});
test.each([{ statusCode: '403', message: 'new row violates row-level security policy' }, { code: '42501', message: 'permission denied' }])('only explicit pre-POST Storage policy rejection permits signed retry %p', async error => {
  mockLegacyUpload.mockResolvedValue({ error }); await fill(); const original = new File(['original'], 'original.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('外観の写真を選択'), { target: { files: [original] } }); await submit();
  const retry = await screen.findByRole('button', { name: '安全なアップロードで再試行' }); expect(request).not.toHaveBeenCalled(); expect(mockCaptcha).not.toHaveBeenCalled();
  request.mockResolvedValue(response(503, { state: 'unavailable' })); fireEvent.click(retry);
  await screen.findByText(/送信の準備が完了していません/); expect(mockCaptcha).toHaveBeenCalledTimes(1);
  expect(request.mock.calls.map(([path]) => path)).toEqual(['/api/salons/prepare']);
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ recaptcha_token: 'fresh-captcha' });
  expect(await screen.findByAltText('外観')).toBeVisible(); expect(mockLegacyUpload).toHaveBeenCalledTimes(1); expect(mockSignedUpload).not.toHaveBeenCalled();
  fireEvent.click(download()); await screen.findByText(/バックアップファイルを作成しました/);
  expect(mockExport).toHaveBeenCalledWith(expect.objectContaining({ facility_name: '合成施設' }), [original, null, null, null, null, null, null]);
});
test('signed photo-token issue failure after manual retry retains originals and never commits', async () => {
  mockLegacyUpload.mockResolvedValue({ error: { code: '42501' } }); await fill(); const original = new File(['original'], 'original.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('外観の写真を選択'), { target: { files: [original] } }); await submit();
  request.mockResolvedValueOnce(response(201, { state: 'prepared', intentId, consumerVersion: 2, photoLimits: { maxBytes: 10485760, mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } })).mockResolvedValueOnce(response(503, { state: 'unavailable' }));
  fireEvent.click(await screen.findByRole('button', { name: '安全なアップロードで再試行' })); await screen.findByText(/送信の準備が完了していません/);
  expect(request.mock.calls.map(([path]) => path)).toEqual(['/api/salons/prepare', '/api/salons/photos']); expect(mockSignedUpload).not.toHaveBeenCalled();
  expect(await screen.findByAltText('外観')).toBeVisible(); expect(restore()).toBeDisabled(); expect(download()).toBeEnabled();
  fireEvent.click(download()); await screen.findByText(/バックアップファイルを作成しました/); expect(mockExport.mock.calls[0][1][0]).toBe(original);
});
test.each([{ statusCode: '403', message: 'generic forbidden' }, { statusCode: '500', message: 'row-level security' }, new Error('network failure')])('generic upload error never offers new signed intent %p', async error => {
  mockLegacyUpload.mockResolvedValue({ error }); await fill(); fireEvent.change(screen.getByLabelText('外観の写真を選択'), { target: { files: [new File(['original'], 'original.png', { type: 'image/png' })] } });
  await submit(); await waitFor(() => expect(screen.getByRole('button', { name: '登録する' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: '安全なアップロードで再試行' })).not.toBeInTheDocument(); expect(request).not.toHaveBeenCalled();
});
test('V1 unknown outcome blocks backup/import and any new signed intent', async () => {
  mockLegacyUpload.mockResolvedValue({ error: null }); request.mockRejectedValue(new Error('lost POST response')); await fill(); await submit();
  await screen.findByText(/登録済みの可能性があります/); expect(download()).toBeDisabled(); expect(restore()).toBeDisabled();
  fireEvent.change(restore(), { target: { files: [draftFile] } }); expect(mockImport).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: '安全なアップロードで再試行' })).not.toBeInTheDocument(); expect(request.mock.calls.map(([path]) => path)).toEqual(['/api/salons']);
});

test('two distinct parallel RLS photo errors still expose the explicit signed retry without a POST', async () => {
  mockLegacyUpload.mockResolvedValueOnce({ error: { statusCode: '403', message: 'new row violates row-level security policy', request: 'first' } })
    .mockResolvedValueOnce({ error: { statusCode: '403', message: 'new row violates row-level security policy', request: 'second' } });
  await fill();
  fireEvent.change(screen.getByLabelText('外観の写真を選択'), { target: { files: [new File(['first'], 'first.png', { type: 'image/png' })] } });
  fireEvent.change(screen.getByLabelText('内観 1の写真を選択'), { target: { files: [new File(['second'], 'second.png', { type: 'image/png' })] } });
  await submit(); expect(await screen.findByRole('button', { name: '安全なアップロードで再試行' })).toBeEnabled();
  expect(mockLegacyUpload).toHaveBeenCalledTimes(2); expect(request).not.toHaveBeenCalled();
});
test.each([false, true])('photo edits retain current originals across back/next and final upload (restored=%s)', async restored => {
  const original = new File(['original-bytes'], 'original.png', { type: 'image/png' });
  const last = new File(['last-bytes'], 'last.png', { type: 'image/png' });
  const replacement = new File(['replacement-bytes'], 'replacement.webp', { type: 'image/webp' });
  await fill();
  if (restored) {
    mockImport.mockResolvedValue({ values: validValues, photos: [original, null, null, null, null, null, last] });
    fireEvent.change(restore(), { target: { files: [draftFile] } }); await screen.findByText(/入力と元の写真を復元しました/); await toLastStep();
    screen.getAllByRole('checkbox').forEach(box => fireEvent.click(box));
  } else {
    fireEvent.change(screen.getByLabelText('外観の写真を選択'), { target: { files: [original] } });
    fireEvent.change(screen.getByLabelText('メニュー 3の写真を選択'), { target: { files: [last] } });
  }
  await screen.findByAltText('外観'); fireEvent.click(screen.getByRole('button', { name: '外観の写真を削除' }));
  fireEvent.change(screen.getByLabelText('外観の写真を選択'), { target: { files: [replacement] } });
  fireEvent.click(screen.getByRole('button', { name: '戻る' })); await screen.findByLabelText(/^郵便番号/);
  fireEvent.click(screen.getByRole('button', { name: '次へ' })); await screen.findByRole('button', { name: '登録する' });
  expect(await screen.findByAltText('外観')).toHaveAttribute('src', 'data:image/webp;base64,cmVwbGFjZW1lbnQtYnl0ZXM=');
  expect(await screen.findByAltText('メニュー 3')).toBeVisible();
  fireEvent.click(download()); await screen.findByText(/バックアップファイルを作成しました/);
  expect(mockExport.mock.calls.at(-1)[1]).toEqual([replacement, null, null, null, null, null, last]);
  mockLegacyUpload.mockResolvedValue({ error: null }); request.mockResolvedValue(response(200, { success: true, id: '22222222-2222-4222-8222-222222222222' }));
  await submit(); await waitFor(() => expect(mockRouter.push).toHaveBeenCalledTimes(1));
  expect(mockLegacyUpload.mock.calls.map(call => call[1])).toEqual([replacement, last]);
});

test('phase changed during backup serialization prevents download and locks controls', async () => {
  await mount(); fireEvent.change(screen.getByLabelText(/^施設名/), { target: { value: '保持する入力' } });
  let resolveBackup: (value: unknown) => void = () => undefined;
  mockExport.mockImplementation(() => new Promise(resolve => { resolveBackup = resolve; }));
  fireEvent.click(download()); await waitFor(() => expect(mockExport).toHaveBeenCalledTimes(1));
  sessionStorage.setItem(SALON_BROWSER_CONTEXT_KEY, JSON.stringify({ version: 1, intentId, phase: 'attempted' }));
  await act(async () => { resolveBackup(new Blob(['backup'])); });
  await screen.findByText('バックアップを保存できませんでした。入力と元の写真はこの画面に保持されています。');
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled(); expect(download()).toBeDisabled(); expect(restore()).toBeDisabled();
  expect(screen.getByLabelText(/^施設名/)).toHaveValue('保持する入力'); expect(request).not.toHaveBeenCalled();
});

test('known V1 acceptance latches until redirect and blocks backup/import/re-submit', async () => {
  await fill(); request.mockResolvedValue(response(200, { success: true, id: '22222222-2222-4222-8222-222222222222' }));
  await submit(); await waitFor(() => expect(mockRouter.push).toHaveBeenCalledTimes(1));
  expect(download()).toBeDisabled(); expect(restore()).toBeDisabled(); expect(screen.getByRole('button', { name: '登録する' })).toBeDisabled();
  fireEvent.click(download()); fireEvent.change(restore(), { target: { files: [draftFile] } }); fireEvent.click(screen.getByRole('button', { name: '登録する' }));
  await act(async () => { await Promise.resolve(); });
  expect(mockExport).not.toHaveBeenCalled(); expect(mockImport).not.toHaveBeenCalled(); expect(request.mock.calls.map(([path]) => path)).toEqual(['/api/salons']);
});

test.each(['locked','unavailable'])('manual file restoration cannot bypass a durable %s fence after session storage loss', async kind => {
 await mount(); fireEvent.change(screen.getByLabelText(/^施設名/), { target: { value: 'Unchanged unsent input' } });
 mockReadLocal.mockImplementation(async () => { if (kind === 'unavailable') throw new Error('unknown local state'); return { state: 'locked' }; });
 fireEvent.change(restore(), { target: { files: [draftFile] } });
 await screen.findByText(/下書きを復元できませんでした/);
 expect(mockImport).not.toHaveBeenCalled(); expect(screen.getByLabelText(/^施設名/)).toHaveValue('Unchanged unsent input');
 expect(request).not.toHaveBeenCalled(); expect(mockCaptcha).not.toHaveBeenCalled();
});

test('a durable fence acquired while a portable backup is decoded prevents all input changes', async () => {
 await mount(); fireEvent.change(screen.getByLabelText(/^施設名/), { target: { value: 'Original input' } });
 mockReadLocal.mockResolvedValueOnce(null).mockResolvedValueOnce({ state: 'locked' });
 mockImport.mockResolvedValue({ values: validValues, photos: Array(7).fill(null) });
 fireEvent.change(restore(), { target: { files: [draftFile] } });
 await screen.findByText(/下書きを復元できませんでした/);
 expect(screen.getByLabelText(/^施設名/)).toHaveValue('Original input'); expect(request).not.toHaveBeenCalled();
});
