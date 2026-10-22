/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import ForgotPasswordPage from '../page';

const mockReset = jest.fn();
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({ auth: { resetPasswordForEmail: mockReset } }),
}));

beforeEach(() => {
  mockReset.mockReset();
  mockReset.mockResolvedValue({ data: {}, error: null });
});

async function requestReset() {
  render(<ForgotPasswordPage />);
  fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'owner@example.invalid' } });
  fireEvent.click(screen.getByRole('button', { name: 'リセットメールを送信' }));
}

test('the sent screen tells the user to open the link in this same browser', async () => {
  await requestReset();
  expect(await screen.findByRole('heading', { name: 'メールを送信しました' })).toBeInTheDocument();
  // 再設定リンクは申請したブラウザでしか使えない（PKCE の確認情報がこのブラウザにだけ残る）
  expect(screen.getByText('リンクは、このページを開いているのと同じブラウザで開いてください。')).toBeInTheDocument();
  expect(screen.getByText(/別のブラウザやメールアプリ内のブラウザで開くと、パスワードを再設定できません。/)).toBeInTheDocument();
  expect(mockReset).toHaveBeenCalledWith('owner@example.invalid', {
    redirectTo: `${window.location.origin}/auth/reset-password`,
  });
});

test('the sent screen tells the user to copy the link without opening it (regression)', async () => {
  // 旧文言「その場合は、リンクをコピーしてこのブラウザに貼り付けてください」は、別のブラウザで
  // 開いてしまった後の対処として読める。メールのリンクは一度開いた時点で使用済みになるので、
  // その後に貼り直しても通らない。開く前にコピーしてもらう。
  await requestReset();
  await screen.findByRole('heading', { name: 'メールを送信しました' });
  expect(screen.getByText(/リンクをタップせずに長押しでコピーし、このブラウザのアドレス欄に貼り付けてください。/)).toBeInTheDocument();
  expect(screen.getByText('メールのリンクは一度開くと使えなくなります。')).toBeInTheDocument();
  expect(screen.queryByText(/その場合は、リンクをコピーしてこのブラウザに貼り付けてください。/)).not.toBeInTheDocument();
});

test('a send failure keeps the form and does not show the sent screen', async () => {
  mockReset.mockResolvedValue({ data: null, error: { message: 'rate limited' } });
  await requestReset();
  expect(await screen.findByText('メール送信に失敗しました。時間をおいて再度お試しください。')).toBeInTheDocument();
  expect(screen.queryByText('リンクは、このページを開いているのと同じブラウザで開いてください。')).not.toBeInTheDocument();
});
