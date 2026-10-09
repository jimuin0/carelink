/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RegisterForm from '@/components/register/RegisterForm';
import { SALON_BROWSER_CONTEXT_KEY } from '@/lib/salon-browser-context';
import { salonPhotoPath } from '@/lib/salon-photo-contract';
const mockRouter = { push: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/recaptcha-client', () => ({ getRecaptchaToken: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/image-compress', () => ({ compressImage: jest.fn(async (file: File) => file) }));
const mockLegacyUpload = jest.fn();
const mockSignedUpload = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { storage: { from: () => ({
  upload: mockLegacyUpload, uploadToSignedUrl: mockSignedUpload,
}) } } }));
const intentId = '11111111-1111-4111-8111-111111111111';
const receiptId = '22222222-2222-4222-8222-222222222222';
const response = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;
let request: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks(); sessionStorage.clear(); request = jest.fn(); global.fetch = request;
  // jsdom does not provide this Web API; requests are mocked, not sent.
  Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: () => new AbortController().signal });
});
async function fill(v2Enabled = true) {
  render(<RegisterForm v2Enabled={v2Enabled} />);
  await waitFor(() => expect(screen.getByLabelText(/^施設名/)).toBeEnabled());
  for (const [label, value] of [[/^施設名/, '合成施設'], [/^業種/, 'ヘアサロン'], [/^代表者名/, '合成代表'],
    [/^担当者名/, '合成担当'], [/^メールアドレス/, 'fixture@example.invalid'], [/^電話番号/, '09012345678']] as const) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  await screen.findByLabelText(/^郵便番号/);
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  await screen.findByRole('button', { name: '登録する' });
  screen.getAllByRole('checkbox').forEach(box => fireEvent.click(box));
}
async function submit() {
  fireEvent.click(screen.getByRole('button', { name: '登録する' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '送信する' }));
}
test('v2 real form and coordinator use prepare then commit, with no legacy upload or PII redirect', async () => {
  request.mockResolvedValueOnce(response(201, { state: 'prepared', intentId, consumerVersion: 2, photoLimits: { maxBytes: 10485760, mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } }))
    .mockResolvedValueOnce(response(201, { state: 'committed', receiptId }));
  await fill(); await submit();
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/register/complete?handoff=registration'));
  expect(request.mock.calls.map(([path]) => path)).toEqual(['/api/salons/prepare', '/api/salons/commit']);
  expect(JSON.parse(sessionStorage.getItem(SALON_BROWSER_CONTEXT_KEY)!)).toEqual({ version: 1, intentId, phase: 'confirmed' });
  expect(mockLegacyUpload).not.toHaveBeenCalled(); expect(mockSignedUpload).not.toHaveBeenCalled();
});

test('OFF with attempted context reconciles instead of permitting a new V1 submission', async () => {
  sessionStorage.setItem(SALON_BROWSER_CONTEXT_KEY, JSON.stringify({ version: 1, intentId, phase: 'attempted' }));
  request.mockResolvedValue(response(200, { state: 'uncommitted' }));
  render(<RegisterForm v2Enabled={false} />);
  await screen.findByText(/送信結果を確認できませんでした。同じ申込/);
  expect(screen.getByLabelText(/^施設名/)).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '同じ申込の受付状況を確認' }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(request.mock.calls.map(([path]) => path)).toEqual(['/api/salons/status', '/api/salons/status']);
  expect(mockLegacyUpload).not.toHaveBeenCalled(); expect(mockSignedUpload).not.toHaveBeenCalled();
  expect(mockRouter.push).not.toHaveBeenCalled();
});

test.each(['prepared', 'confirmed'])('OFF with %s context confirms the original receipt, not V1', async phase => {
  sessionStorage.setItem(SALON_BROWSER_CONTEXT_KEY, JSON.stringify({ version: 1, intentId, phase }));
  request.mockResolvedValue(response(200, { state: 'committed', receiptId }));
  render(<RegisterForm v2Enabled={false} />);
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/register/complete?handoff=registration'));
  expect(request.mock.calls.map(([path]) => path)).toEqual(['/api/salons/status']);
  expect(mockLegacyUpload).not.toHaveBeenCalled();
});

test('OFF with a prepared intent refreshes its own handshake and finishes without a new intent or V1', async () => {
  sessionStorage.setItem(SALON_BROWSER_CONTEXT_KEY, JSON.stringify({ version: 1, intentId, phase: 'prepared' }));
  request.mockResolvedValueOnce(response(200, { state: 'uncommitted' }))
    .mockResolvedValueOnce(response(200, { state: 'uncommitted' }))
    .mockResolvedValueOnce(response(200, { state: 'prepared', intentId, consumerVersion: 2, photoLimits: { maxBytes: 10485760, mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } }))
    .mockResolvedValueOnce(response(201, { state: 'committed', receiptId }));
  await fill(false); await submit();
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledTimes(1));
  expect(request.mock.calls.map(([path]) => path)).toEqual(['/api/salons/status', '/api/salons/status', '/api/salons/prepare', '/api/salons/commit']);
  expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({ intentId });
  expect(JSON.parse(request.mock.calls[3][1].body).intentId).toBe(intentId);
  expect(mockLegacyUpload).not.toHaveBeenCalled();
});

test('OFF with corrupt saved progress does not silently fall back to V1', async () => {
  sessionStorage.setItem(SALON_BROWSER_CONTEXT_KEY, '{');
  render(<RegisterForm v2Enabled={false} />);
  await screen.findByText(/この申込の確認情報を利用できません/);
  expect(screen.getByLabelText(/^施設名/)).toBeDisabled(); expect(request).not.toHaveBeenCalled();
});

test('OFF with unavailable session storage blocks new input instead of losing old progress', async () => {
  const unavailable = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('fixture storage unavailable'); });
  try {
    render(<RegisterForm v2Enabled={false} />);
    await screen.findByText(/この申込の確認情報を利用できません/);
    expect(screen.getByLabelText(/^施設名/)).toBeDisabled(); expect(request).not.toHaveBeenCalled();
  } finally { unavailable.mockRestore(); }
});
test('lost outcome disables new submission, then readonly reconciliation navigates once', async () => {
  request.mockResolvedValueOnce(response(201, { state: 'prepared', intentId, consumerVersion: 2, photoLimits: { maxBytes: 10485760, mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } })).mockRejectedValueOnce(new Error('lost'))
    .mockResolvedValueOnce(response(200, { state: 'committed', receiptId }));
  await fill(); await submit();
  await screen.findByText(/送信結果を確認できませんでした。同じ申込/);
  expect(screen.getByRole('button', { name: '登録する' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '同じ申込の受付状況を確認' }));
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledTimes(1));
  expect(request.mock.calls.map(([path]) => path)).toEqual(['/api/salons/prepare', '/api/salons/commit', '/api/salons/status']);
});
test('preparation failure preserves the form for a safe retry, without a commit', async () => {
  request.mockResolvedValueOnce(response(503, { state: 'unavailable' }));
  await fill(); await submit();
  await screen.findByText(/送信の準備が完了していません/);
  expect(screen.getByRole('button', { name: '登録する' })).toBeEnabled();
  expect(request).toHaveBeenCalledTimes(1); expect(mockRouter.push).not.toHaveBeenCalled();
});
test('corrupt saved context fails closed before any request or user input', async () => {
  sessionStorage.setItem(SALON_BROWSER_CONTEXT_KEY, '{');
  render(<RegisterForm v2Enabled />);
  await screen.findByText(/この申込の確認情報を利用できません/);
  expect(screen.getByLabelText(/^施設名/)).toBeDisabled(); expect(request).not.toHaveBeenCalled();
});
test('commit400 preserves original input/photos and only replays the same payload after status verification', async () => {
  const photoId = '33333333-3333-4333-8333-333333333333';
  const path = salonPhotoPath(intentId, photoId, 'image/png');
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => '44444444-4444-4444-8444-444444444444' });
  request.mockResolvedValueOnce(response(201, { state: 'prepared', intentId, consumerVersion: 2, photoLimits: { maxBytes: 10485760, mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } }))
    .mockResolvedValueOnce(response(200, { state: 'uploaded', photoId, path }))
    .mockResolvedValueOnce(response(400, { state: 'invalid', fieldErrors: { contact_phone: 'PRIVATE' } }))
    .mockResolvedValueOnce(response(200, { state: 'uncommitted' }))
    .mockResolvedValueOnce(response(200, { state: 'uncommitted' }))
    .mockResolvedValueOnce(response(200, { state: 'replay', receiptId }));
  await fill();
  fireEvent.change(screen.getByLabelText('メニュー 1の写真を選択'), {
    target: { files: [new File(['fixture'], 'fixture.png', { type: 'image/png' })] },
  });
  await submit();
  await screen.findByText(/送信結果を確認できませんでした。同じ申込/);
  expect(screen.getByRole('button', { name: '登録する' })).toBeDisabled();
  expect(screen.queryByText('PRIVATE')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '同じ申込の受付状況を確認' }));
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledTimes(1));
  const commits = request.mock.calls.filter(([url]) => url === '/api/salons/commit').map(([, init]) => JSON.parse(init.body));
  expect(commits).toHaveLength(2); expect(commits[1]).toEqual(commits[0]);
  expect(commits[0].registration.facility_name).toBe('合成施設');
  const photos = request.mock.calls.filter(([url]) => url === '/api/salons/photos').map(([, init]) => JSON.parse(init.body));
  expect(photos).toHaveLength(1); expect(photos[0].slot).toBe(4);
  expect(mockLegacyUpload).not.toHaveBeenCalled();
});
