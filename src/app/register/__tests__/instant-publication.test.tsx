/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RegisterForm from '@/components/register/RegisterForm';
const mockRouter = { push: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
jest.mock('@/lib/recaptcha-client', () => ({ getRecaptchaToken: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/image-compress', () => ({ compressImage: jest.fn(async (file: File) => file) }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: jest.fn() }) } }) }));
const intentId = '11111111-1111-4111-8111-111111111111';
const receiptId = '22222222-2222-4222-8222-222222222222';
const response = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;
let request: jest.Mock;
beforeEach(() => {
  process.env.NEXT_PUBLIC_REGISTRATION_AUTO_PUBLISH = 'true';
  jest.clearAllMocks(); sessionStorage.clear(); request = jest.fn(); global.fetch = request;
  Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: () => new AbortController().signal });
});
afterEach(() => { delete process.env.NEXT_PUBLIC_REGISTRATION_AUTO_PUBLISH; });
async function firstStep() {
  render(<RegisterForm v2Enabled />);
  await waitFor(() => expect(screen.getByLabelText(/^店舗名/)).toBeEnabled());
  for (const [label, value] of [[/^店舗名/, '合成施設'], [/^業種/, 'ヘアサロン'], [/^代表者名/, '合成代表'],
    [/^メールアドレス/, 'fixture@example.invalid'], [/^電話番号/, '09012345678']] as const) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  await screen.findByLabelText(/^郵便番号/);
}
function fillHours() {
  for (const day of ['日', '火', '水', '木', '金', '土']) fireEvent.click(screen.getByRole('checkbox', { name: `${day}曜日に営業する` }));
  fireEvent.change(screen.getByLabelText('月曜日の開店時間'), { target: { value: '09:00' } });
  fireEvent.change(screen.getByLabelText('月曜日の閉店時間'), { target: { value: '17:00' } });
}
test('does not proceed without explicit hours and location, then sends the confirmed week', async () => {
  request.mockResolvedValueOnce(response(201, { state: 'prepared', intentId, consumerVersion: 2, photoLimits: { maxBytes: 10485760, mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } }))
    .mockResolvedValueOnce(response(201, { state: 'committed', receiptId }));
  await firstStep();
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  expect(await screen.findByText('曜日別の営業時間を確認してください。')).toBeVisible();
  expect(request).not.toHaveBeenCalled();
  fillHours();
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  await screen.findByText(/住所を入力してください/);
  fireEvent.change(screen.getByLabelText(/^住所/), { target: { value: '大阪府大阪市北区梅田1-1' } });
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  await screen.findByRole('button', { name: '登録する' });
  screen.getAllByRole('checkbox').forEach(box => fireEvent.click(box));
  fireEvent.click(screen.getByRole('button', { name: '登録する' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '送信する' }));
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/register/complete?handoff=registration'));
  const commit = request.mock.calls.find(([url]) => url === '/api/salons/commit');
  expect(JSON.parse(commit[1].body).publicationHours).toEqual({ sun: null, mon: { open: '09:00', close: '17:00' }, tue: null, wed: null, thu: null, fri: null, sat: null });
});
