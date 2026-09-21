/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import { act, fireEvent, within } from '@testing-library/react';
import RegisterForm from '@/components/register/RegisterForm';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/recaptcha-client', () => ({ getRecaptchaToken: jest.fn().mockResolvedValue(null) }));

test('SSRでは入力不可と回復リンクを提示し、RHF準備完了後の最初の入力を失わない', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  container.innerHTML = renderToString(<RegisterForm />);
  const view = within(container);
  expect(view.getByLabelText(/^施設名/)).toBeDisabled();
  expect(view.getByRole('button', { name: '次へ' })).toBeDisabled();
  expect(view.getByRole('status')).toHaveTextContent('JavaScript');
  expect(view.getByRole('button', { name: 'ページを再読み込み' }).closest('form')).toHaveAttribute('action', '/register');

  let root: Root | undefined;
  try {
    await act(async () => { root = hydrateRoot(container, <RegisterForm />); });
    expect(view.getByLabelText(/^施設名/)).toBeEnabled();
    expect(view.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.change(view.getByLabelText(/^施設名/), { target: { value: '初回入力施設' } });
    fireEvent.change(view.getByLabelText(/^業種/), { target: { value: 'ヘアサロン' } });
    fireEvent.change(view.getByLabelText(/^代表者名/), { target: { value: '代表 太郎' } });
    fireEvent.change(view.getByLabelText(/^担当者名/), { target: { value: '担当 花子' } });
    fireEvent.change(view.getByLabelText(/^メールアドレス/), { target: { value: 'fixture@example.invalid' } });
    fireEvent.change(view.getByLabelText(/^電話番号/), { target: { value: '09012345678' } });
    fireEvent.click(view.getByRole('button', { name: '次へ' }));
    await view.findByLabelText(/^郵便番号/);
    fireEvent.click(view.getByRole('button', { name: '戻る' }));
    expect(view.getByLabelText(/^施設名/)).toHaveValue('初回入力施設');
  } finally {
    await act(async () => { root?.unmount(); });
    container.remove();
  }
});
