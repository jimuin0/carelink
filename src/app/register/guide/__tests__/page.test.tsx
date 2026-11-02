/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import RegistrationGuidePage from '../page';

test('掲載までの流れと複数店舗・無料掲載の案内が順に読める', () => {
  render(<RegistrationGuidePage />);
  const steps = within(screen.getByRole('list', { name: '掲載までの4つの手順' })).getAllByRole('listitem');
  expect(steps).toHaveLength(4);
  expect(steps.map(step => within(step).getByRole('heading').textContent)).toEqual([
    '店舗ごとに申し込む', 'アカウントで引き継ぐ', '書類を提出する', '情報を整えて公開する',
  ]);
  expect(screen.getByText(/店舗ごとに申し込み、同じ確認済みメールアドレス/)).toBeVisible();
  expect(screen.getByText(/ネット予約の利用は任意/)).toBeVisible();
  expect(screen.getByRole('link', { name: '運営に問い合わせる' })).toHaveAttribute('href', '/contact');
});
