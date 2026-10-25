/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import RegisterCompletePage from '../page';
import { resolveRegisteredSalon } from '@/lib/register-complete';

jest.mock('next/headers', () => ({ cookies: jest.fn(async () => ({ get: () => ({ value: 'signed-fixture' }) })) }));
jest.mock('@/lib/register-complete', () => ({ resolveRegisteredSalon: jest.fn() }));

const id = '11111111-2222-4333-8444-555555555555';

test.each(['unverified', 'not_found', 'unavailable'] as const)('%s does not claim receipt or invite blind resubmission', async (status) => {
  jest.mocked(resolveRegisteredSalon).mockResolvedValue({ status });
  render(await RegisterCompletePage({ searchParams: Promise.resolve({ id }) }));
  expect(screen.queryByText('掲載申込を受け付けました')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '受付状況を問い合わせる' })).toHaveAttribute('href', '/contact');
  expect(screen.queryByRole('link', { name: /アカウントを作成/ })).not.toBeInTheDocument();
  expect(screen.getByText(/再送信せず/)).toBeVisible();
});

test('confirmed receipt displays reference and forwards the signed claim to lookup', async () => {
  jest.mocked(resolveRegisteredSalon).mockResolvedValue({ status: 'confirmed', id, name: '合成施設', type: 'ヘアサロン', area: '東京都' });
  render(await RegisterCompletePage({ searchParams: Promise.resolve({ id }) }));
  expect(screen.getByText('掲載申込を受け付けました')).toBeVisible();
  // 受付番号は書き写せる短い参照（先頭8桁）を大きく出し、照会用の完全な番号を添える。
  expect(screen.getByTestId('receipt-short')).toHaveTextContent('1111-1111');
  expect(screen.getByText(id)).not.toBeVisible();
  fireEvent.click(screen.getByText('お問い合わせ用の番号'));
  expect(screen.getByText(id)).toBeVisible();
  expect(screen.getByText('店舗名')).toBeVisible();
  expect(screen.getByRole('link', { name: '店舗アカウントを作成する' })).toBeVisible();
  expect(resolveRegisteredSalon).toHaveBeenCalledWith(id, 'signed-fixture');
});
