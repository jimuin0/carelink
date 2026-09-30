/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import RegisterCompletePage from '@/app/register/complete/page';
import { resolveRegisteredSalon } from '@/lib/register-complete';

jest.mock('@/lib/register-complete', () => ({ resolveRegisteredSalon: jest.fn() }));

test('既存アカウントのログイン導線も登録済み施設情報をonboardingへ引き継ぐ', async () => {
  (resolveRegisteredSalon as jest.Mock).mockResolvedValue({
    name: 'テスト施設',
    type: 'ヘアサロン',
    area: '東京都',
  });

  render(await RegisterCompletePage({ searchParams: Promise.resolve({ id: '11111111-2222-3333-4444-555555555555' }) }));

  const loginLink = screen.getByRole('link', { name: '既にアカウントをお持ちの方はログイン' });
  expect(loginLink).toHaveAttribute(
    'href',
    `/auth/login?redirect=${encodeURIComponent(`/admin/onboarding?facility_name=${encodeURIComponent('テスト施設')}&business_type=${encodeURIComponent('ヘアサロン')}`)}`,
  );
});
