/**
 * @jest-environment jsdom
 *
 * 予約完了画面の「予約通知を受け取る」バナー（E21・2026年10月23日 見直し）。
 * - 出すのは、登録すれば実際に届くとき（ログイン中・この端末が未登録・別の端末の登録が無い）だけ
 *   以前はゲストにも出て、押すと必ず 401 →「時間をおいて再度お試しください」になった。
 * - 許可済みでもサーバーの登録が消えていれば出す（以前は許可済みなら二度と出ず、登録し直せなかった）
 * - 文言に、送っていない「リマインド」を書かない
 * - 保存に失敗したら閉じずに理由を出す（成功偽装をしない）
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: jest.fn() }));

const VAPID = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8';
const HERE = 'https://fcm.googleapis.com/fcm/send/this-device';
const OTHER = 'https://fcm.googleapis.com/fcm/send/other-device';
process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = VAPID;
// 動的 import は React を二重ロードし hook 不整合になるため、同一 React インスタンスを使う require で読み込む。
const PushPermissionBanner = require('@/components/push/PushPermissionBanner').default;

type Env = { permission?: NotificationPermission; signedIn?: boolean; local?: string | null; server?: string | null; serverError?: unknown; postStatus?: number };

function install(env: Env) {
  (global as unknown as { Notification: unknown }).Notification = {
    permission: env.permission ?? 'default',
    requestPermission: jest.fn().mockResolvedValue('granted'),
  };
  (global as unknown as { PushManager: unknown }).PushManager = function PushManager() {};
  const subscriptionFor = (endpoint: string) => ({ endpoint, toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }) });
  const registration = {
    pushManager: {
      getSubscription: () => Promise.resolve(env.local ? subscriptionFor(env.local) : null),
      subscribe: jest.fn().mockResolvedValue(subscriptionFor(HERE)),
    },
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve(registration), getRegistration: () => Promise.resolve(registration) },
  });
  const status = env.postStatus ?? 200;
  global.fetch = jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status }) as unknown as typeof fetch;
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: env.signedIn === false ? null : { id: 'customer-1' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: env.server ? { endpoint: env.server } : null, error: env.serverError ?? null }),
        }),
      }),
    }),
  });
}

async function renderBanner() {
  jest.useFakeTimers();
  render(<PushPermissionBanner />);
  // 登録状況の確認（非同期）→ 3 秒後に表示。
  await act(async () => { await jest.advanceTimersByTimeAsync(3000); });
  jest.useRealTimers();
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('ログインしていない（ゲストの予約）には出さない：押しても登録できないため', async () => {
  install({ signedIn: false });
  await renderBanner();
  expect(screen.queryByText('通知を許可')).not.toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('ログイン中で未登録なら出し、文言は実際に送る通知だけを書く（リマインドを約束しない）', async () => {
  install({});
  await renderBanner();
  expect(await screen.findByText('通知を許可')).toBeInTheDocument();
  expect(screen.getByText(/予約の確定・キャンセル・日時の変更など/)).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('リマインド');
});

test('許可済みでもサーバーの登録が消えていれば、もう一度出して登録し直せる', async () => {
  install({ permission: 'granted', local: HERE, server: null });
  await renderBanner();
  fireEvent.click(await screen.findByText('通知を許可'));
  await waitFor(() => expect(screen.queryByText('通知を許可')).not.toBeInTheDocument());
  expect(global.fetch).toHaveBeenCalledWith('/api/push/subscribe', expect.objectContaining({ method: 'POST' }));
});

test.each([
  ['この端末で登録済み', { permission: 'granted' as const, local: HERE, server: HERE }],
  ['別の端末が登録済み（ここで押すといつもの端末に届かなくなる）', { server: OTHER }],
  ['通知がブロックされている', { permission: 'denied' as const }],
  ['登録状況を確認できない', { serverError: { code: '522' } }],
])('%s → 出さない', async (_label, env) => {
  install(env);
  await renderBanner();
  expect(screen.queryByText('通知を許可')).not.toBeInTheDocument();
});

test('保存に失敗したらエラーを出し、バナーは閉じない（成功偽装をしない）', async () => {
  install({ postStatus: 500 });
  await renderBanner();
  fireEvent.click(await screen.findByText('通知を許可'));
  expect(await screen.findByRole('alert')).toHaveTextContent('通知の登録に失敗しました');
  expect(screen.getByText('通知を許可')).toBeInTheDocument();
});

test('ログインが切れていた（401）ときは「時間をおいて」ではなく、ログインし直すよう案内する', async () => {
  install({ postStatus: 401 });
  await renderBanner();
  fireEvent.click(await screen.findByText('通知を許可'));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('ログインし直してから');
  expect(alert).not.toHaveTextContent('時間をおいて');
  expect(screen.getByText('通知を許可')).toBeInTheDocument();
});

test('「後で」で閉じる', async () => {
  install({});
  await renderBanner();
  fireEvent.click(await screen.findByText('後で'));
  expect(screen.queryByText('通知を許可')).not.toBeInTheDocument();
});

test('表示前に画面を離れたら、あとから表示しない', async () => {
  install({});
  jest.useFakeTimers();
  const { unmount } = render(<PushPermissionBanner />);
  await act(async () => { await Promise.resolve(); });
  unmount();
  await act(async () => { await jest.advanceTimersByTimeAsync(3000); });
  jest.useRealTimers();
  expect(screen.queryByText('通知を許可')).not.toBeInTheDocument();
});
