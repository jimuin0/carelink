/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import RegistrationGuidePage from '../page';
import { REGISTRATION_STEPS } from '@/lib/registration-flow';

test('掲載までの流れを 4 ステップの図で見せ、書類・無料掲載・複数店舗を図で案内する', () => {
  render(<RegistrationGuidePage />);
  const steps = within(screen.getByRole('list', { name: '掲載までの4ステップ' })).getAllByRole('listitem');
  expect(steps).toHaveLength(4);
  REGISTRATION_STEPS.forEach((step, index) => expect(steps[index]).toHaveTextContent(step.title));
  expect(screen.getByRole('heading', { name: 'STEP 3 の書類（どれか1点）' })).toBeVisible();
  expect(within(screen.getByRole('list', { name: 'ファイルの条件' })).getAllByRole('listitem').map(item => item.textContent))
    .toEqual(['PDF・JPEG・PNG', '10MBまで', '金額や口座番号は隠してOK']);
  expect(screen.getByText('ネット予約（任意）')).toBeVisible();
  expect(screen.getByRole('figure', { name: '1つのアカウントで複数店舗を管理' })).toBeVisible();
  expect(screen.getByRole('link', { name: '運営に問い合わせる' })).toHaveAttribute('href', '/contact');
});

test('<main> はレイアウトに任せて二重にせず、ページ名を持つ', async () => {
  const { metadata } = await import('../page');
  render(<RegistrationGuidePage />);
  expect(screen.queryByRole('main')).toBeNull();
  expect(metadata.title).toBe('掲載までの流れ');
});
