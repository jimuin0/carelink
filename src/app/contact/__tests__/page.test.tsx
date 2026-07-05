/**
 * @jest-environment jsdom
 *
 * お問い合わせページ: salon/premium の料金プランから ?plan=standard 等で遷移した場合、
 * お問い合わせ種別・内容に自動反映する（プラン文脈が消えて営業機会を逃す不具合の防止）。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import ContactPage from '@/app/contact/page';

const mockSearchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

beforeEach(() => {
  Array.from(mockSearchParams.keys()).forEach((k) => mockSearchParams.delete(k));
});

test('?plan=standard → お問い合わせ種別「施設掲載について」・内容にプラン名を自動反映', async () => {
  mockSearchParams.set('plan', 'standard');
  render(<ContactPage />);
  const select = (await screen.findByLabelText(/お問い合わせ種別/)) as HTMLSelectElement;
  expect(select.value).toBe('施設掲載について（オーナー向け）');
  const textarea = screen.getByLabelText(/内容/) as HTMLTextAreaElement;
  expect(textarea.value).toContain('スタンダードプラン');
});

test('?plan=enterprise → エンタープライズプランを反映', async () => {
  mockSearchParams.set('plan', 'enterprise');
  render(<ContactPage />);
  const textarea = (await screen.findByLabelText(/内容/)) as HTMLTextAreaElement;
  expect(textarea.value).toContain('エンタープライズプラン');
});

test('未知のplan値 → 何も自動反映しない', async () => {
  mockSearchParams.set('plan', 'unknown-plan');
  render(<ContactPage />);
  const select = (await screen.findByLabelText(/お問い合わせ種別/)) as HTMLSelectElement;
  expect(select.value).toBe('');
});

test('plan クエリなし → 通常のお問い合わせフォーム（従来通り）', async () => {
  render(<ContactPage />);
  const select = (await screen.findByLabelText(/お問い合わせ種別/)) as HTMLSelectElement;
  expect(select.value).toBe('');
  const textarea = screen.getByLabelText(/内容/) as HTMLTextAreaElement;
  expect(textarea.value).toBe('');
});
