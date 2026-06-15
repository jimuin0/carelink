/**
 * @jest-environment jsdom
 *
 * PushPermissionBanner の購読保存エラー挙動テスト。
 * - /api/push/subscribe が res.ok=true → バナーが閉じる（購読完了）
 * - res.ok=false → エラー表示し、バナーは閉じない（購読失敗を成功偽装しない・再試行可能・回帰防止）
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';

const VAPID = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8';
// モジュール先頭で env を読むため、require 前に設定。動的 import は React を二重ロードし
// hook 不整合になるため、同一 React インスタンスを使う require で読み込む。
process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = VAPID;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PushPermissionBanner = require('@/components/push/PushPermissionBanner').default;

function setupBrowserApis(fetchImpl: jest.Mock) {
  (global as unknown as { Notification: unknown }).Notification = {
    permission: 'default',
    requestPermission: jest.fn().mockResolvedValue('granted'),
  };
  (global as unknown as { PushManager: unknown }).PushManager = function () {};
  const subscribe = jest.fn().mockResolvedValue({
    toJSON: () => ({ endpoint: 'https://example.test/ep', keys: { p256dh: 'a', auth: 'b' } }),
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { subscribe } }) },
  });
  global.fetch = fetchImpl as unknown as typeof fetch;
}

function renderBanner() {
  jest.useFakeTimers();
  render(<PushPermissionBanner />);
  act(() => { jest.advanceTimersByTime(3000); }); // 3秒後にバナー表示
  jest.useRealTimers();
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('res.ok=true → バナーが閉じる（購読完了）', async () => {
  setupBrowserApis(jest.fn().mockResolvedValue({ ok: true }));
  renderBanner();
  const allowBtn = await screen.findByText('通知を許可');
  fireEvent.click(allowBtn);
  await screen.findByText('後で'); // まだ表示確認の足場
  // 成功すると show=false で null を返す
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByText('通知を許可')).not.toBeInTheDocument();
});

test('res.ok=false → エラー表示・バナーは閉じない（成功偽装防止・回帰防止）', async () => {
  setupBrowserApis(jest.fn().mockResolvedValue({ ok: false }));
  renderBanner();
  const allowBtn = await screen.findByText('通知を許可');
  fireEvent.click(allowBtn);
  expect(await screen.findByRole('alert')).toHaveTextContent('通知の登録に失敗しました');
  expect(screen.getByText('通知を許可')).toBeInTheDocument(); // バナーは残る
});
