/**
 * @jest-environment jsdom
 *
 * QASection の質問投稿。
 * - 失敗の可視化（旧実装は catch { // silent } で失敗が顧客に一切見えなかった）。
 * - 2026年10月22日: 質問はブラウザから facility_qa へ直接 INSERT せず、POST /api/facility/qa に送る。
 *   直接 INSERT では回答欄や公開状態まで書けて（施設名義の偽回答）、店舗にも何も届かなかった。
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QASection from '@/components/facility/QASection';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: jest.fn() }));

const fetchMock = jest.fn();
const insert = jest.fn();

function mockSupabase({ userId = 'user-1' as string | null } = {}) {
  const select = jest.fn(() => ({
    eq: () => ({
      eq: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  }));
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: userId ? { id: userId } : null } }) },
    from: jest.fn(() => ({ select, insert })),
  });
}

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValue({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

async function ask(text = 'この施設は駐車場がありますか？') {
  const user = userEvent.setup();
  render(<QASection facilityId="f1" />);
  const textarea = await screen.findByLabelText('質問を入力');
  await user.type(textarea, text);
  await user.click(screen.getByRole('button', { name: '質問する' }));
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockSupabase();
});

test('質問は API に施設と質問文だけを送り、ブラウザから facility_qa へ書かない', async () => {
  respond(201, { success: true, id: 'qa-1' });
  await ask('  この施設は駐車場がありますか？  ');
  expect(await screen.findByText('質問を送信しました。施設からの回答をお待ちください。')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('/api/facility/qa', expect.objectContaining({ method: 'POST' }));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ facility_id: 'f1', question: 'この施設は駐車場がありますか？' });
  expect(insert).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(screen.getByLabelText('質問を入力')).toHaveValue('');
});

test('サーバーの失敗(500) → 既定の文言を Toast で明示する（握り潰し回帰防止）', async () => {
  respond(500, { error: '質問の送信に失敗しました。時間をおいて再度お試しください。' });
  await ask();
  expect(await screen.findByRole('alert')).toHaveTextContent('質問の送信に失敗しました。もう一度お試しください。');
  expect(screen.queryByText('質問を送信しました。施設からの回答をお待ちください。')).not.toBeInTheDocument();
});

test('回数制限など利用者が対処できる理由(4xx)はサーバーの文言をそのまま見せる', async () => {
  respond(429, { error: '質問の投稿が続いています。しばらくしてからお試しください。' });
  await ask();
  expect(await screen.findByRole('alert')).toHaveTextContent('質問の投稿が続いています。しばらくしてからお試しください。');
});

test('4xx でも本文が読めなければ既定の文言', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 400, json: () => Promise.reject(new Error('not json')) });
  await ask();
  expect(await screen.findByRole('alert')).toHaveTextContent('質問の送信に失敗しました。もう一度お試しください。');
});

test('通信断 → 既定の文言を Toast で明示する', async () => {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
  await ask();
  expect(await screen.findByRole('alert')).toHaveTextContent('質問の送信に失敗しました。もう一度お試しください。');
});

test('ログインしていなければ投稿欄を出さない', async () => {
  mockSupabase({ userId: null });
  render(<QASection facilityId="f1" />);
  expect(await screen.findByText('Q&Aはまだありません。')).toBeInTheDocument();
  expect(screen.queryByLabelText('質問を入力')).not.toBeInTheDocument();
});
