/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RegisterForm from '@/components/register/RegisterForm';

const mockPush = jest.fn();
const mockUpload = jest.fn();
const mockRemove = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/recaptcha-client', () => ({ getRecaptchaToken: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/image-compress', () => ({ compressImage: jest.fn(async (file: File) => file) }));
jest.mock('@/lib/supabase', () => ({ supabase: { storage: { from: () => ({
  upload: mockUpload, remove: mockRemove,
  getPublicUrl: (path: string) => ({ data: { publicUrl: `https://fixture.invalid/${path}` } }),
}) } } }));
jest.mock('@/components/MultiPhotoUpload', () => ({ __esModule: true, default: ({ onChange }: { onChange: (files: File[]) => void }) => (
  <button type="button" onClick={() => onChange([new File(['fixture'], 'exterior.jpg', { type: 'image/jpeg' }), new File(['fixture'], 'interior.jpg', { type: 'image/jpeg' })])}>合成写真を選択</button>
) }));

const id = '11111111-1111-1111-1111-111111111111';
const jsonResponse = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
let mockFetch: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockRemove.mockReset().mockResolvedValue({ error: null });
  mockFetch = jest.fn().mockResolvedValue(jsonResponse(200, { success: true, id }));
  global.fetch = mockFetch;
});

async function prepareForm(phone = '09012345678', contactPhone?: string) {
  render(<RegisterForm />);
  fireEvent.change(screen.getByLabelText(/^施設名/), { target: { value: '合成施設' } });
  fireEvent.change(screen.getByLabelText(/^業種/), { target: { value: 'ヘアサロン' } });
  fireEvent.change(screen.getByLabelText(/^代表者名/), { target: { value: '合成代表' } });
  fireEvent.change(screen.getByLabelText(/^担当者名/), { target: { value: '合成担当' } });
  fireEvent.change(screen.getByLabelText(/^メールアドレス/), { target: { value: 'fixture@example.invalid' } });
  fireEvent.change(screen.getByLabelText(/^電話番号/), { target: { value: phone } });
  if (contactPhone) {
    const direct = screen.getByLabelText('担当者直通電話');
    direct.closest('details')!.open = true;
    fireEvent.change(direct, { target: { value: contactPhone } });
    expect(direct).toHaveValue('03-1234-5678');
    expect(screen.getByLabelText(/^電話番号/)).toHaveValue('090-1234-5678');
  }
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  await screen.findByLabelText(/^郵便番号/);
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  fireEvent.click(await screen.findByRole('button', { name: '合成写真を選択' }));
  screen.getAllByRole('checkbox').forEach((box) => fireEvent.click(box));
}

async function submit() {
  fireEvent.click(screen.getByRole('button', { name: '登録する' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '送信する' }));
}

test('full-width phone and direct phone survive the real UI and submit normalized values', async () => {
  await prepareForm('０９０１２３４５６７８', '０３ー１２３４ー５６７８');
  await submit();
  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
  const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
  expect(payload.phone).toBe('090-1234-5678');
  expect(payload.contact_phone).toBe('03-1234-5678');
});

test('photo-specific rejection is visible without losing the selected files', async () => {
  mockFetch.mockResolvedValueOnce(jsonResponse(400, { error: '施設写真を確認してください', fieldErrors: { photo_urls: 'invalid' } }));
  await prepareForm();
  await submit();
  expect(await screen.findByText('施設写真を確認してください（最大7枚）')).toBeVisible();
  expect(mockPush).not.toHaveBeenCalled();
});

test('正常登録は写真を保持して確認済みidの完了画面へ1回進む', async () => {
  await prepareForm();
  await submit();
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/register/complete?id=${id}`));
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(mockRemove).not.toHaveBeenCalled();
});

test('server field errors return to their step, open optional fields and preserve the input', async () => {
  mockFetch.mockResolvedValueOnce(jsonResponse(400, {
    error: '入力内容を確認してください', fieldErrors: { website: 'WebサイトURLを確認してください' },
  }));
  await prepareForm();
  await submit();
  const website = await screen.findByLabelText('WebサイトURL');
  expect(website.closest('details')).toHaveAttribute('open');
  await waitFor(() => expect(website).toHaveFocus());
  expect(screen.getByLabelText(/^施設名/)).toHaveValue('合成施設');
  expect(screen.getByText('WebサイトURLを確認してください（2000文字以内）')).toBeVisible();
  expect(mockPush).not.toHaveBeenCalled();
});

test('早期upload失敗後の遅延成功を待ち、成功写真をcleanupしてPOSTしない', async () => {
  let resolveLate!: (value: { error: null }) => void;
  mockUpload.mockResolvedValueOnce({ error: new Error('fixture upload failure') })
    .mockImplementationOnce(() => new Promise((resolve) => { resolveLate = resolve; }));
  await prepareForm();
  await submit();
  await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(2));
  expect(mockRemove).not.toHaveBeenCalled();
  expect(mockFetch).not.toHaveBeenCalled();
  await act(async () => { resolveLate({ error: null }); });
  await waitFor(() => expect(mockRemove).toHaveBeenCalledTimes(1));
  expect(mockRemove.mock.calls[0][0]).toEqual([mockUpload.mock.calls[1][0]]);
  expect(mockFetch).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '登録する' })).toBeEnabled();
});

test.each([400, 403, 429])('明確な%s拒否は写真cleanup・元のエラー表示後に再送できる', async (status) => {
  mockFetch.mockResolvedValueOnce(jsonResponse(status, { error: '合成の入力エラー' }));
  await prepareForm();
  await submit();
  await screen.findByText('合成の入力エラー');
  expect(mockRemove).toHaveBeenCalledTimes(1);
  expect(mockRemove.mock.calls[0][0]).toHaveLength(2);
  expect(screen.getByRole('button', { name: '登録する' })).toBeEnabled();
  await submit();
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/register/complete?id=${id}`));
  expect(mockFetch).toHaveBeenCalledTimes(2);
});

test.each(['network', 'server', 'malformed', 'missing-id', 'invalid-id'])('%sの結果不明は写真保全・再送抑止・照合案内となる', async (failure) => {
  if (failure === 'network') mockFetch.mockRejectedValueOnce(new Error('fixture response lost'));
  else if (failure === 'server') mockFetch.mockResolvedValueOnce(jsonResponse(500, { error: 'error' }));
  else if (failure === 'malformed') mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('fixture malformed'); } });
  else mockFetch.mockResolvedValueOnce(jsonResponse(200, failure === 'missing-id' ? { success: true } : { success: true, id: 'invalid' }));
  await prepareForm();
  await submit();
  await screen.findByText(/送信結果を確認できませんでした/);
  expect(screen.getByRole('link', { name: '受付状況を問い合わせる' })).toHaveAttribute('href', '/contact');
  const button = screen.getByRole('button', { name: '登録する' });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(mockRemove).not.toHaveBeenCalled();
  expect(mockPush).not.toHaveBeenCalled();
});
