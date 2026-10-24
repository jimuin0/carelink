/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import PasswordStrengthMeter from '../PasswordStrengthMeter';

let mockImportFails = false;
jest.mock('@/lib/password-strength', () => ({
  get estimatePasswordStrength() {
    if (mockImportFails) throw new Error('fixture loading failure');
    return (value: string) => ({ low: 0, middle: 2, high: 4 })[value] ?? 1;
  },
}));
afterEach(() => { mockImportFails = false; });

test('empty input stays neutral and has an accessible meter', () => {
  render(<PasswordStrengthMeter password="" />);
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '未入力');
  expect(screen.getByText('流出の有無は登録時に確認します。')).toBeInTheDocument();
});

test('updates through low, middle and high, and resets immediately when cleared', async () => {
  const view = render(<PasswordStrengthMeter password="low" />);
  const meter = screen.getByRole('meter');
  await waitFor(() => expect(meter).toHaveAttribute('aria-valuetext', '低い'));
  expect(meter).toHaveAttribute('aria-valuenow', '1');
  view.rerender(<PasswordStrengthMeter password="middle" />);
  await waitFor(() => expect(meter).toHaveAttribute('aria-valuetext', '中程度'));
  expect(meter).toHaveAttribute('aria-valuenow', '2');
  view.rerender(<PasswordStrengthMeter password="high" />);
  await waitFor(() => expect(meter).toHaveAttribute('aria-valuetext', '高い'));
  expect(meter).toHaveAttribute('aria-valuenow', '3');
  view.rerender(<PasswordStrengthMeter password="" />);
  expect(meter).toHaveAttribute('aria-valuetext', '未入力');
  expect(meter).toHaveAttribute('aria-valuenow', '0');
});

test('loading failure stays neutral and can recover after clearing the field', async () => {
  mockImportFails = true;
  const view = render(<PasswordStrengthMeter password="high" />);
  await waitFor(() => expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '判定できません'));
  expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '0');
  view.rerender(<PasswordStrengthMeter password="" />);
  mockImportFails = false;
  view.rerender(<PasswordStrengthMeter password="high" />);
  await waitFor(() => expect(screen.getByRole('meter')).toHaveAttribute('aria-valuetext', '高い'));
});
