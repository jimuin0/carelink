/**
 * @jest-environment jsdom
 *
 * お問い合わせページ: salon/premium の料金プランから ?plan=standard 等で遷移した場合、
 * お問い合わせ種別・内容に自動反映する（プラン文脈が消えて営業機会を逃す不具合の防止）。
 */
import '@testing-library/jest-dom';
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react';
import ContactPage from '@/app/contact/page';

const mockSearchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
}));

beforeEach(() => {
  Array.from(mockSearchParams.keys()).forEach((k) => mockSearchParams.delete(k));
});

afterEach(() => {
  jest.restoreAllMocks();
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

test('確認ダイアログの確定ボタンを連打しても /api/contact への送信は1回だけ（二重送信防止・回帰）', async () => {
  const fetchMock = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response)
  );
  global.fetch = fetchMock as unknown as typeof fetch;

  render(<ContactPage />);

  fireEvent.change(screen.getByLabelText(/お名前/), { target: { value: '山田太郎' } });
  fireEvent.change(screen.getByLabelText(/メールアドレス/), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByLabelText(/お問い合わせ種別/), { target: { value: 'その他' } });
  fireEvent.change(screen.getByLabelText(/内容/), { target: { value: 'テスト内容です。' } });
  fireEvent.click(screen.getByRole('checkbox'));

  fireEvent.click(screen.getByRole('button', { name: '送信する' }));

  const dialog = await screen.findByRole('dialog');
  const confirmButton = within(dialog).getByRole('button', { name: '送信する' });
  // 同一tick内での連打を再現（1つの act() にまとめ、1クリック目のReact再レンダーが
  // コミットされる前に2クリック目のハンドラが実行される race window を突く）
  act(() => {
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
  });

  await waitFor(() => expect(screen.getByText('送信が完了しました')).toBeInTheDocument());
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
