/**
 * @jest-environment jsdom
 *
 * AiChatbot の応答ハンドリング回帰テスト。
 * - 正常(200) → AI返答をそのまま表示（既存挙動の不変確認）
 * - HTTPエラー(429/503) → res.ok を検証し、エラーを「正常なAI返答」に偽装しない（成功偽装防止・回帰防止）
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import AiChatbot from '@/components/AiChatbot';

// jsdom は scrollIntoView 未実装のため polyfill（messages 更新時の useEffect が参照）
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
});

function mockFetch(ok: boolean, status: number, body: object) {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok, status, json: () => Promise.resolve(body) }),
  ) as unknown as typeof fetch;
}

afterEach(() => jest.clearAllMocks());

function openAndSendQuickQuestion() {
  fireEvent.click(screen.getByLabelText('AIアシスタントに質問する'));
  fireEvent.click(screen.getByText('近くの鍼灸院を探したい'));
}

test('正常応答(200) → AI返答をそのまま表示する', async () => {
  mockFetch(true, 200, { reply: 'お近くの鍼灸院をご案内します。' });
  render(<AiChatbot />);
  openAndSendQuickQuestion();
  expect(await screen.findByText('お近くの鍼灸院をご案内します。')).toBeInTheDocument();
});

test('429 → エラーを正常返答に偽装せず「混み合っています」を表示（成功偽装防止）', async () => {
  mockFetch(false, 429, { error: 'Rate limit exceeded' });
  render(<AiChatbot />);
  openAndSendQuickQuestion();
  expect(
    await screen.findByText('混み合っています。少し時間をおいて再度お試しください。'),
  ).toBeInTheDocument();
  // 旧実装のフォールバック（正常返答に見える文言）を出さないこと
  expect(screen.queryByText('すみません、うまく回答できませんでした。')).not.toBeInTheDocument();
});

test('503 → 「エラーが発生しました」を表示し偽装しない（成功偽装防止）', async () => {
  mockFetch(false, 503, { error: 'AIサービスに接続できませんでした' });
  render(<AiChatbot />);
  openAndSendQuickQuestion();
  expect(
    await screen.findByText('エラーが発生しました。もう一度お試しください。'),
  ).toBeInTheDocument();
  expect(screen.queryByText('すみません、うまく回答できませんでした。')).not.toBeInTheDocument();
});
