/**
 * @jest-environment jsdom
 *
 * AiSupportWidget の応答ハンドリング回帰テスト。
 * - 正常(200) → AI返答をそのまま表示（既存挙動の不変確認）
 * - HTTPエラー(429/500) → res.ok を検証し、障害（レート制限等）を一律フォールバック文言に潰さない（成功偽装防止・回帰防止）
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import AiSupportWidget from '@/components/admin/AiSupportWidget';

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
  fireEvent.click(screen.getByLabelText('AIサポート'));
  fireEvent.click(screen.getByText('メニューを追加するには？'));
}

test('正常応答(200) → AI返答をそのまま表示する', async () => {
  mockFetch(true, 200, { reply: 'メニュー管理から追加できます。' });
  render(<AiSupportWidget />);
  openAndSendQuickQuestion();
  expect(await screen.findByText('メニュー管理から追加できます。')).toBeInTheDocument();
});

test('429 → 障害を区別して「リクエストが多すぎます」を表示（成功偽装防止）', async () => {
  mockFetch(false, 429, { error: 'リクエストが多すぎます' });
  render(<AiSupportWidget />);
  openAndSendQuickQuestion();
  expect(
    await screen.findByText('リクエストが多すぎます。少し待って再度お試しください。'),
  ).toBeInTheDocument();
});

test('500 → 「エラーが発生しました」を表示し偽装しない（成功偽装防止）', async () => {
  mockFetch(false, 500, { error: 'AI処理に失敗しました' });
  render(<AiSupportWidget />);
  openAndSendQuickQuestion();
  expect(
    await screen.findByText('エラーが発生しました。もう一度お試しください。'),
  ).toBeInTheDocument();
});
