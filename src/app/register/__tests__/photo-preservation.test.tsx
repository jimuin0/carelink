/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import RegisterForm from '@/components/register/RegisterForm';

const mockPush = jest.fn();
const mockUpload = jest.fn().mockResolvedValue({ error: null });
const mockRemove = jest.fn().mockResolvedValue({ error: null });
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/recaptcha-client', () => ({ getRecaptchaToken: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/image-compress', () => ({ compressImage: jest.fn(async (file: File) => file) }));
jest.mock('@/lib/supabase', () => ({ supabase: { storage: { from: () => ({ upload: mockUpload, remove: mockRemove, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://fixture.invalid/${path}` } }) }) } } }));

test('real photo picker retains previews/files after a rejected submit and permits removal before retry', async () => {
  const response = (status: number, body: unknown) => ({ ok: status === 200, status, json: async () => body });
  const fetchMock = jest.fn()
    .mockResolvedValueOnce(response(400, { error: '入力内容を確認してください', fieldErrors: { building_name: 'invalid' } }))
    .mockResolvedValueOnce(response(200, { success: true, id: '11111111-2222-4333-8444-555555555555' }));
  global.fetch = fetchMock;
  render(<RegisterForm />);
  for (const [label, value] of [
    [/^施設名/, '合成施設'], [/^業種/, 'ヘアサロン'], [/^代表者名/, '合成代表'], [/^担当者名/, '合成担当'], [/^メールアドレス/, 'fixture@example.invalid'], [/^電話番号/, '09012345678'],
  ] as const) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  await screen.findByLabelText(/^郵便番号/);
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  await screen.findByRole('button', { name: '登録する' });
  const first = new File(['first'], 'first.png', { type: 'image/png' });
  const second = new File(['second'], 'second.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('外観の写真を選択'), { target: { files: [first] } });
  fireEvent.change(screen.getByLabelText('内観 1の写真を選択'), { target: { files: [second] } });
  await waitFor(() => { expect(screen.getByAltText('外観')).toBeVisible(); expect(screen.getByAltText('内観 1')).toBeVisible(); });
  screen.getAllByRole('checkbox').forEach(box => fireEvent.click(box));
  const submit = async () => {
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '送信する' }));
  };
  await submit();
  const building = await screen.findByLabelText('建物名・部屋番号');
  await waitFor(() => expect(building).toHaveFocus());
  expect(building.closest('details')).toHaveAttribute('open');
  expect(mockRemove).toHaveBeenCalledTimes(1);
  fireEvent.change(building, { target: { value: '合成建物' } });
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  await screen.findByRole('button', { name: '登録する' });
  expect(screen.getByAltText('外観')).toBeVisible();
  expect(screen.getByAltText('内観 1')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '外観の写真を削除' }));
  const third = new File(['third'], 'third.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('内観 2の写真を選択'), { target: { files: [third] } });
  await waitFor(() => expect(screen.getByAltText('内観 2')).toBeVisible());
  await submit();
  await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
  expect(mockUpload.mock.calls.map(call => call[1])).toEqual([first, second, second, third]);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).building_name).toBe('合成建物');
});
