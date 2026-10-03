/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import LegacyRegisterForm from '../../../../e2e/fixtures/legacy-register-form';

// Exact old-main component; JSDOM protocol negative, not real Storage/browser
// evidence. Only external transport/compression are stubs. Form/photo UI is real.
const mockPush = jest.fn();
const mockUpload = jest.fn();
const mockRemove = jest.fn().mockResolvedValue({ error: null });
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/recaptcha-client', () => ({ getRecaptchaToken: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/image-compress', () => ({ compressImage: jest.fn(async (file: File) => file) }));
jest.mock('@/lib/supabase', () => ({ supabase: { storage: { from: () => ({
  upload: mockUpload, remove: mockRemove,
  getPublicUrl: (path: string) => ({ data: { publicUrl: `https://fixture.invalid/${path}` } }),
}) } } }));

beforeEach(() => { jest.clearAllMocks(); sessionStorage.clear(); });
test('historical component fixture is unchanged from main 3d8e6c53', () => {
  const bytes = readFileSync('e2e/fixtures/legacy-register-form.tsx');
  expect(createHash('sha256').update(bytes).digest('hex'))
    .toBe('3e71f9770e68fa212cdf6aafab5c9c3d42c133917ba55f27574ffb4aa133f1a7');
});
test('unpatched V1 retains mounted inputs/files after policy denial but cannot switch to signed uploads or restore after reload', async () => {
  const request = jest.fn(); global.fetch = request;
  // Permission changes after mount, before first upload. No business-success stub.
  let policyClosed = false;
  mockUpload.mockImplementation(async () => ({ error: policyClosed ? { statusCode: '403', message: 'synthetic RLS denial' } : null }));
  const mounted = render(<LegacyRegisterForm v2Enabled={false} />);
  await waitFor(() => expect(screen.getByLabelText(/^施設名/)).toBeEnabled());
  for (const [label, value] of [[/^施設名/, '合成旧施設'], [/^業種/, 'ヘアサロン'], [/^代表者名/, '合成代表'],
    [/^担当者名/, '合成担当'], [/^メールアドレス/, 'old-fixture@example.invalid'], [/^電話番号/, '09012345678']] as const) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  await screen.findByLabelText(/^郵便番号/);
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
  await screen.findByRole('button', { name: '登録する' });
  fireEvent.change(screen.getByLabelText(/^PR文/), { target: { value: '合成未送信の内容' } });
  const original = new File(['exact synthetic bytes'], 'original.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('外観の写真を選択'), { target: { files: [original] } });
  await waitFor(() => expect(screen.getByAltText('外観')).toBeVisible());
  screen.getAllByRole('checkbox').forEach(box => fireEvent.click(box));
  policyClosed = true;
  const submit = async () => {
    fireEvent.click(screen.getByRole('button', { name: '登録する' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '送信する' }));
  };
  await submit();
  await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: '登録する' })).toBeEnabled());
  expect(request).not.toHaveBeenCalled(); expect(mockPush).not.toHaveBeenCalled();
  expect(mockUpload.mock.calls[0][1]).toBe(original);
  expect(screen.getByAltText('外観')).toBeVisible();
  expect(screen.getByLabelText(/^PR文/)).toHaveValue('合成未送信の内容');
  expect(screen.queryByRole('button', { name: '安全なアップロードで再試行' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '入力と元の写真をバックアップ' })).not.toBeInTheDocument();
  await submit();
  await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(2));
  expect(mockUpload.mock.calls[1][1]).toBe(original);
  expect(request).not.toHaveBeenCalled();
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 8 * 86400000);
  try {
    expect(screen.getByAltText('外観')).toBeVisible();
    expect(screen.getByLabelText(/^PR文/)).toHaveValue('合成未送信の内容');
  } finally { clock.mockRestore(); }
  // Unmount/remount models a full reload's lost React memory, without claiming
  // browser navigation, Cache, IndexedDB or Storage behavior was exercised.
  mounted.unmount();
  render(<LegacyRegisterForm v2Enabled={false} />);
  await waitFor(() => expect(screen.getByLabelText(/^施設名/)).toBeEnabled());
  expect(screen.getByLabelText(/^施設名/)).toHaveValue('');
  expect(screen.getByLabelText(/^メールアドレス/)).toHaveValue('');
  expect(screen.queryByAltText('外観')).not.toBeInTheDocument();
}, 30000);
