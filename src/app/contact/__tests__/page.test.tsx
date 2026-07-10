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

// このページは送信前に getRecaptchaToken を呼ぶ。テスト環境（jest.setup.js）は
// NEXT_PUBLIC_RECAPTCHA_SITE_KEY を設定するため、モックしないと本物の
// loadRecaptchaScript が <script> の onload を待って jsdom で永久にハングする
// （symptoms/page.test.tsx と同じ既知の地雷）。
jest.mock('@/lib/recaptcha-client', () => ({
  getRecaptchaToken: jest.fn().mockResolvedValue(null),
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

// reCAPTCHA token 未配線の恒久根治（review.ts と非対称だった穴を閉じる）の回帰防止。
// getRecaptchaToken が実トークンを返した場合、送信body に recaptcha_token として含める。
test('getRecaptchaToken がトークンを返す → 送信bodyに recaptcha_token を含める', async () => {
  const { getRecaptchaToken } = jest.requireMock('@/lib/recaptcha-client') as {
    getRecaptchaToken: jest.Mock;
  };
  getRecaptchaToken.mockResolvedValueOnce('real-token-123');

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
  fireEvent.click(within(dialog).getByRole('button', { name: '送信する' }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  const [, options] = fetchMock.mock.calls[0];
  const body = JSON.parse((options as RequestInit).body as string);
  expect(body.recaptcha_token).toBe('real-token-123');
});

// fetch が !ok を返す（サーバ側400/403/500等）場合、エラートーストを表示する回帰防止。
test('送信APIがエラーレスポンス → エラーメッセージをトーストで表示する', async () => {
  const fetchMock = jest.fn(() =>
    Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ error: 'Bot検知: 時間をおいて再度お試しください' }),
    } as Response)
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
  fireEvent.click(within(dialog).getByRole('button', { name: '送信する' }));

  await waitFor(() => expect(screen.getByText('Bot検知: 時間をおいて再度お試しください')).toBeInTheDocument());
});
