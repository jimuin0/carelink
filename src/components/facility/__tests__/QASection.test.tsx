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

// 2026年10月23日（神原さん判断）: 公開中の Q&A が 0 件の施設では Q&A タブを出さない。
// そのとき質問を送る機能が消えないよう、お問い合わせ欄の下に投稿欄だけの入口（askOnly）を置く。
describe('質問だけの入口（askOnly）', () => {
  const LOGIN = '/auth/login?redirect=%2Ffacility%2Fhal%23qa-ask';

  afterEach(() => { window.location.hash = ''; });

  test('ログイン中: 投稿欄を出し、一覧は読まない。送信は同じ API を通る', async () => {
    respond(201, { success: true, id: 'qa-1' });
    const user = userEvent.setup();
    render(<QASection facilityId="f1" askOnly loginHref={LOGIN} />);
    await user.click(screen.getByText('この施設に質問する'));
    await user.type(await screen.findByLabelText('質問を入力'), '駐車場はありますか？');
    await user.click(screen.getByRole('button', { name: '質問する' }));
    expect(await screen.findByText('質問を送信しました。施設からの回答をお待ちください。')).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ facility_id: 'f1', question: '駐車場はありますか？' });
    // 一覧（facility_qa の読み取り）はしない＝空の「Q&Aはまだありません。」も出ない
    const clients = (createBrowserSupabaseClient as jest.Mock).mock.results.map((r) => r.value);
    expect(clients.length).toBeGreaterThan(0);
    expect(clients.every((c) => (c.from as jest.Mock).mock.calls.length === 0)).toBe(true);
    expect(screen.queryByText('Q&Aはまだありません。')).not.toBeInTheDocument();
  });

  test('未ログイン: 投稿欄は出さず、#qa-ask に戻るログイン導線を出す', async () => {
    mockSupabase({ userId: null });
    render(<QASection facilityId="f1" askOnly loginHref={LOGIN} />);
    const link = await screen.findByRole('link', { name: 'ログインして質問する' });
    expect(link).toHaveAttribute('href', LOGIN);
    expect(screen.queryByLabelText('質問を入力')).not.toBeInTheDocument();
  });

  test('ふだんは閉じた小さな入口で、ログインから #qa-ask で戻ったときは開いて出す', async () => {
    const closed = render(<QASection facilityId="f1" askOnly loginHref={LOGIN} />);
    const details = closed.container.querySelector('details#qa-ask') as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    closed.unmount();

    window.location.hash = '#qa-ask';
    const opened = render(<QASection facilityId="f1" askOnly loginHref={LOGIN} />);
    expect((opened.container.querySelector('details#qa-ask') as HTMLDetailsElement).open).toBe(true);
    await screen.findByLabelText('質問を入力');
  });
});
