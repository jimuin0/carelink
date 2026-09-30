/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import RegisterCompletePage from '../page';
import { resolveRegisteredSalon } from '@/lib/register-complete';

jest.mock('next/headers', () => ({ cookies: jest.fn(async () => ({ get: () => ({ value: 'signed-fixture' }) })) }));
jest.mock('@/lib/register-complete', () => ({ resolveRegisteredSalon: jest.fn() }));

const id = '11111111-2222-4333-8444-555555555555';

test.each(['unverified', 'not_found', 'unavailable'] as const)('%s does not claim receipt or invite blind resubmission', async (status) => {
  jest.mocked(resolveRegisteredSalon).mockResolvedValue({ status });
  render(await RegisterCompletePage({ searchParams: Promise.resolve({ id }) }));
  expect(screen.queryByText('登録が完了しました！')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '受付状況を問い合わせる' })).toHaveAttribute('href', '/contact');
  expect(screen.queryByRole('link', { name: /アカウントを作成/ })).not.toBeInTheDocument();
  expect(screen.getByText(/再送信せず/)).toBeVisible();
});

test('confirmed receipt displays reference and forwards the signed claim to lookup', async () => {
  jest.mocked(resolveRegisteredSalon).mockResolvedValue({ status: 'confirmed', id, name: '合成施設', type: 'ヘアサロン', area: '東京都' });
  render(await RegisterCompletePage({ searchParams: Promise.resolve({ id }) }));
  expect(screen.getByText('登録が完了しました！')).toBeVisible();
  expect(screen.getByText(id)).toBeVisible();
  expect(resolveRegisteredSalon).toHaveBeenCalledWith(id, 'signed-fixture');
});
