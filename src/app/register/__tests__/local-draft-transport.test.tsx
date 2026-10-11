/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RegisterForm from '@/components/register/RegisterForm';
import { SALON_BROWSER_CONTEXT_KEY } from '@/lib/salon-browser-context';
const mockPush = jest.fn(); const mockRouter = { push: mockPush };
const mockFence = jest.fn(); const mockConfirmed = jest.fn(); const mockKnownRejection = jest.fn();
const mockUpload = jest.fn(); const mockFetch = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/recaptcha-client', () => ({ getRecaptchaToken: async () => null }));
jest.mock('@/lib/image-compress', () => ({ compressImage: async (file: File) => file }));
jest.mock('@/lib/supabase', () => ({ supabase: { storage: { from: () => ({ upload: mockUpload, uploadToSignedUrl: mockUpload, remove: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: 'https://example.invalid/synthetic.png' } }) }) } } }));
jest.mock('@/components/register/SalonLocalDraftControls', () => {
 const React = jest.requireActual<typeof import('react')>('react');
 return { SalonLocalDraftControls: React.forwardRef(function MockSalonLocalDraftControls(_props, ref) {
  React.useImperativeHandle(ref, () => ({ beforeSubmit: mockFence, confirmed: mockConfirmed, rejectedBeforeCommit: mockKnownRejection }));
  return React.createElement('div');
 }) };
});
const intentId = 'f8800000-0000-4000-8000-000000000001';
const receiptId = 'f8800000-0000-4000-8000-000000000002';
const response = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const prepared = () => response(201, { state: 'prepared', intentId, consumerVersion: 2, photoLimits: { maxBytes: 10485760, mimeTypes: ['image/png'] } });
beforeEach(() => {
 jest.clearAllMocks(); sessionStorage.clear(); global.fetch = mockFetch;
 mockFence.mockReset().mockResolvedValue(true); mockConfirmed.mockReset().mockResolvedValue(undefined); mockKnownRejection.mockReset().mockResolvedValue(undefined); mockFetch.mockReset();
 Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: () => new AbortController().signal });
});
async function fill(v2Enabled = true) {
 render(<RegisterForm v2Enabled={v2Enabled} />); await waitFor(() => expect(screen.getByLabelText(/^施設名/)).toBeEnabled());
 for (const [label, value] of [[/^施設名/, 'Synthetic local fence'], [/^業種/, 'ヘアサロン'], [/^代表者名/, 'Synthetic'], [/^担当者名/, 'Synthetic'], [/^メールアドレス/, 'synthetic@example.invalid'], [/^電話番号/, '09012345678']] as const)
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
 fireEvent.click(screen.getByRole('button', { name: '次へ' })); await screen.findByLabelText(/^郵便番号/);
 fireEvent.click(screen.getByRole('button', { name: '次へ' })); await screen.findByRole('button', { name: '登録する' });
 screen.getAllByRole('checkbox').forEach(box => fireEvent.click(box));
}
async function submit() {
 fireEvent.click(screen.getByRole('button', { name: '登録する' }));
 const dialog = await screen.findByRole('dialog'); fireEvent.click(within(dialog).getByRole('button', { name: '送信する' }));
}
test.each([true,false])('failed local pretransport fence blocks all V1/V2 requests: %s', async v2 => {
 mockFence.mockResolvedValue(false); await fill(v2); await submit(); await waitFor(() => expect(mockFence).toHaveBeenCalledTimes(1));
 expect(mockFetch).not.toHaveBeenCalled(); expect(mockUpload).not.toHaveBeenCalled(); expect(mockPush).not.toHaveBeenCalled();
 expect(screen.getByRole('button', { name: '登録する' })).toBeEnabled();
});
test('unexpected fence exception is visible and never leaves submission spinner or starts transport', async () => {
 mockFence.mockRejectedValue(new Error('synthetic fence fault')); await fill(); await submit();
 await screen.findByText('端末の下書きを確認できませんでした。送信せず、入力と元の写真を保持しています。');
 expect(mockFetch).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: '登録する' })).toBeEnabled();
});
test('verified receipt survives local delete failure with explicit receipt link and no resend', async () => {
 mockConfirmed.mockRejectedValue(new Error('synthetic quota')); mockFetch.mockResolvedValueOnce(prepared()).mockResolvedValueOnce(response(201, { state: 'committed', receiptId }));
 await fill(); await submit(); await screen.findByText(/掲載申込の受付は確認済みです/);
 expect(screen.getByRole('link', { name: '受付内容を確認する' })).toHaveAttribute('href', '/register/complete?handoff=registration');
 expect(mockPush).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: '登録する' })).toBeDisabled();
 expect(JSON.parse(sessionStorage.getItem(SALON_BROWSER_CONTEXT_KEY)!).phase).toBe('confirmed');
 expect(screen.queryByText(/送信結果を確認できませんでした/)).not.toBeInTheDocument();
});
test('a known prepare failure before any commit may release only the same owned input fence', async () => {
 mockFetch.mockResolvedValueOnce(response(503, {})); await fill(); await submit();
 await waitFor(() => expect(mockKnownRejection).toHaveBeenCalledTimes(1));
 expect(mockFetch.mock.calls.map(([path]) => path)).toEqual(['/api/salons/prepare']);
 expect(mockConfirmed).not.toHaveBeenCalled();
});
test.each(['invalid','unknown'])('commit %s must never release local input fence', async result => {
 mockFetch.mockResolvedValueOnce(prepared()).mockResolvedValueOnce(result === 'invalid' ? response(400, { state: 'invalid' }) : response(202, { state: 'unknown' }));
 await fill(); await submit(); await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
 expect(mockKnownRejection).not.toHaveBeenCalled(); expect(mockConfirmed).not.toHaveBeenCalled(); expect(mockPush).not.toHaveBeenCalled();
});
