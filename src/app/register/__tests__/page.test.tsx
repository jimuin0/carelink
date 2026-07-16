/**
 * @jest-environment jsdom
 *
 * /register ページ: 確認ダイアログの確定ボタンを連打しても /api/salons への
 * 登録POSTは1回だけであることを検証する回帰テスト（二重登録防止）。
 */
import '@testing-library/jest-dom';
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react';
import RegisterPage from '@/app/register/page';

const pushMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

// このページは送信前に getRecaptchaToken を呼ぶ。テスト環境（jest.setup.js）は
// NEXT_PUBLIC_RECAPTCHA_SITE_KEY を設定するため、モックしないと本物の
// loadRecaptchaScript が <script> の onload を待って jsdom で永久にハングする
// （symptoms/page.test.tsx・contact/page.test.tsx と同じ既知の地雷）。
jest.mock('@/lib/recaptcha-client', () => ({
  getRecaptchaToken: jest.fn().mockResolvedValue(null),
}));

afterEach(() => {
  jest.restoreAllMocks();
  pushMock.mockClear();
});

function fillStep1AndAdvance() {
  fireEvent.change(screen.getByLabelText(/^施設名/), { target: { value: 'テスト施設' } });
  fireEvent.change(screen.getByLabelText(/^業種/), { target: { value: 'ヘアサロン' } });
  fireEvent.change(screen.getByLabelText(/^代表者名/), { target: { value: '山田太郎' } });
  fireEvent.change(screen.getByLabelText(/^担当者名/), { target: { value: '山田花子' } });
  fireEvent.change(screen.getByLabelText(/^メールアドレス/), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByLabelText(/^電話番号/), { target: { value: '090-1234-5678' } });
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));
}

test('確認ダイアログの確定ボタンを連打しても /api/salons への送信は1回だけ（二重登録防止・回帰）', async () => {
  const fetchMock = jest.fn((url: string) => {
    if (url === '/api/salons') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, id: 'salon-1' }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  render(<RegisterPage />);

  fillStep1AndAdvance();

  // Step2（必須項目なし）
  await screen.findByLabelText(/^郵便番号/);
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));

  // Step3
  await screen.findByLabelText(/^PR文/);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '登録する' }));

  const dialog = await screen.findByRole('dialog');
  const confirmButton = within(dialog).getByRole('button', { name: '送信する' });
  // 同一tick内での連打を再現（1つの act() にまとめ、1クリック目のReact再レンダーが
  // コミットされる前に2クリック目のハンドラが実行される race window を突く）
  act(() => {
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
  });

  await waitFor(() => expect(pushMock).toHaveBeenCalled());
  const salonPostCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/salons');
  expect(salonPostCalls).toHaveLength(1);
});

// 【2026年7月16日 恒久根治】/api/notify（認証なし公開POST）廃止に伴い、Slack通知は
// /api/salons が保存成功後にサーバー側から直接送るよう移行した。/register 由来か
// /recruit 由来かをサーバーが区別できるよう source フィールドを送る回帰テスト。
test('/api/salons への送信ボディに source: "register" が含まれる（サーバー側Slack通知の振り分け用）', async () => {
  const fetchMock = jest.fn((url: string) => {
    if (url === '/api/salons') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, id: 'salon-1' }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  render(<RegisterPage />);

  fillStep1AndAdvance();

  await screen.findByLabelText(/^郵便番号/);
  fireEvent.click(screen.getByRole('button', { name: '次へ' }));

  await screen.findByLabelText(/^PR文/);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '登録する' }));

  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '送信する' }));

  await waitFor(() => expect(pushMock).toHaveBeenCalled());
  const [, options] = fetchMock.mock.calls.find(([url]) => url === '/api/salons')!;
  const body = JSON.parse((options as RequestInit).body as string);
  expect(body.source).toBe('register');
});
