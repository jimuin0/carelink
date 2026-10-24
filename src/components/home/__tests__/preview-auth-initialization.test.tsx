import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import AuthButton from '@/components/auth/AuthButton';
import HomeUserPanel from '@/components/search/HomeUserPanel';
import StickySignupCta from '../StickySignupCta';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

jest.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: jest.fn(() => {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required');
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

test.each([
  ['header', AuthButton, 'ログイン'],
  ['user panel', HomeUserPanel, 'ログインする'],
  ['signup CTA', StickySignupCta, null],
] as const)('%s keeps the public page usable when auth initialization throws', async (_name, Component, loginLabel) => {
  await act(async () => {
    render(<><h1>ネットでかんたんサロン予約</h1><Component /></>);
  });
  expect(createBrowserSupabaseClient).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('heading', { name: 'ネットでかんたんサロン予約' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'ユーザーメニュー' })).not.toBeInTheDocument();
  if (loginLabel) expect(screen.getByRole('link', { name: loginLabel })).toHaveAttribute('href', '/auth/login?redirect=%2F');
  else expect(screen.queryByRole('link', { name: '無料で会員登録する' })).not.toBeInTheDocument();
});
