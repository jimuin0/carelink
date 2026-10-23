/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import RegisterPage from '@/components/register/RegisterLanding';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/recaptcha-client', () => ({ getRecaptchaToken: jest.fn().mockResolvedValue(null) }));

// 求人は「今はなし」（2026年10月23日 神原さん判断・src/lib/feature-toggles.ts の SHOW_JOBS）。
// 施設向けの掲載案内で「求人掲載 — スタッフ募集も同じ画面から」と約束していた。
test('/register の「できること」に求人掲載を出さない（実在するメニュー掲載を出す）', () => {
  render(<RegisterPage />);
  // 空振り防止: 「できること」は描画されている
  expect(screen.getByRole('heading', { name: 'ネット予約' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'メニュー掲載' })).toBeInTheDocument();
  expect(screen.queryByText('求人掲載')).not.toBeInTheDocument();
  expect(screen.queryByText('スタッフ募集も同じ画面から')).not.toBeInTheDocument();
});
