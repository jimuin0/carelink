/**
 * @jest-environment jsdom
 *
 * 管理画面「この端末のプッシュ通知」（2026年10月22日 新設）。
 * 通知設定に Push のトグルはあったが、オーナーが端末を登録する手段が無く、
 * トグルを ON にしても届け先が無かった。登録・状態表示・解除を固定する。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PushDeviceRegistration from '../PushDeviceRegistration';
import NotificationSettings from '../NotificationSettings';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: jest.fn() }));

const VAPID = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8';
const HERE = 'https://fcm.googleapis.com/fcm/send/this-device';
const OTHER = 'https://fcm.googleapis.com/fcm/send/other-device';

type Env = {
  permission?: NotificationPermission;
  local?: string | null;
  server?: string | null;
  serverError?: unknown;
  postOk?: boolean;
  deleteOk?: boolean;
  noRegistration?: boolean;
};

let env: Env;
let localEndpoint: string | null;
let serverEndpoint: string | null;
const fetchMock = jest.fn();
const unsubscribeMock = jest.fn();
const requestPermission = jest.fn();
const pushSubscribe = jest.fn();

function install(next: Env) {
  env = next;
  localEndpoint = next.local ?? null;
  serverEndpoint = next.server ?? null;
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = VAPID;
  (global as unknown as { Notification: unknown }).Notification = {
    permission: next.permission ?? 'default',
    requestPermission,
  };
  (global as unknown as { PushManager: unknown }).PushManager = function PushManager() {};
  const subscriptionFor = (endpoint: string) => ({
    endpoint,
    unsubscribe: () => { unsubscribeMock(endpoint); localEndpoint = null; return Promise.resolve(true); },
    toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
  });
  const registration = {
    pushManager: {
      getSubscription: () => Promise.resolve(localEndpoint ? subscriptionFor(localEndpoint) : null),
      subscribe: pushSubscribe.mockImplementation(() => { localEndpoint = HERE; return Promise.resolve(subscriptionFor(HERE)); }),
    },
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      ready: Promise.resolve(registration),
      getRegistration: () => Promise.resolve(next.noRegistration ? undefined : registration),
    },
  });
  requestPermission.mockImplementation(() => {
    (global as unknown as { Notification: { permission: string } }).Notification.permission = 'granted';
    return Promise.resolve('granted');
  });
  fetchMock.mockImplementation((_url: string, init: RequestInit) => {
    if (init.method === 'POST') {
      if (env.postOk !== false) serverEndpoint = HERE;
      return Promise.resolve({ ok: env.postOk !== false });
    }
    if (env.deleteOk !== false) serverEndpoint = null;
    return Promise.resolve({ ok: env.deleteOk !== false });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'owner-1' } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve(table === 'push_subscriptions'
            ? { data: serverEndpoint ? { endpoint: serverEndpoint } : null, error: env.serverError ?? null }
            : { data: null, error: null }),
        }),
      }),
    }),
  });
}

const status = () => screen.findByTestId('push-device-status');

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(() => {
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
});

test('未登録の端末は「未登録」と表示し、「この端末で通知を受け取る」で登録できる', async () => {
  install({});
  render(<PushDeviceRegistration />);
  expect(await status()).toHaveTextContent('未登録');
  expect(screen.getByText(/通知を受け取れる端末はアカウントごとに1台です/)).toBeInTheDocument();
  // ログアウトで登録が外れることを書いておく（黙って届かなくなると気づく手がかりが無い）。
  expect(screen.getByText('ログアウトすると、この端末の通知は解除されます。もう一度ログインしたら、改めて登録してください。')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'この端末で通知を受け取る' }));

  await waitFor(() => expect(screen.getByTestId('push-device-status')).toHaveTextContent('この端末で登録済み'));
  expect(requestPermission).toHaveBeenCalled();
  expect(pushSubscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
  expect(fetchMock).toHaveBeenCalledWith('/api/push/subscribe', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ endpoint: HERE, keys: { p256dh: 'p', auth: 'a' } }),
  }));
  expect(screen.getByRole('button', { name: 'この端末の通知を解除' })).toBeInTheDocument();
});

test('この端末が登録済みなら「この端末で登録済み」と表示し、解除するとサーバーの行（この端末分）とブラウザの購読を外す', async () => {
  install({ permission: 'granted', local: HERE, server: HERE });
  render(<PushDeviceRegistration />);
  expect(await status()).toHaveTextContent('この端末で登録済み');

  fireEvent.click(screen.getByRole('button', { name: 'この端末の通知を解除' }));

  await waitFor(() => expect(screen.getByTestId('push-device-status')).toHaveTextContent('未登録'));
  expect(fetchMock).toHaveBeenCalledWith('/api/push/subscribe', expect.objectContaining({
    method: 'DELETE',
    body: JSON.stringify({ endpoint: HERE }),
  }));
  expect(unsubscribeMock).toHaveBeenCalledWith(HERE);
});

test('解除の保存に失敗したらブラウザの購読を残し、失敗を表示する（解除したように見せない）', async () => {
  install({ permission: 'granted', local: HERE, server: HERE, deleteOk: false });
  render(<PushDeviceRegistration />);
  expect(await status()).toHaveTextContent('この端末で登録済み');

  fireEvent.click(screen.getByRole('button', { name: 'この端末の通知を解除' }));

  expect(await screen.findByText('通知の解除に失敗しました。時間をおいて再度お試しください。')).toBeInTheDocument();
  expect(unsubscribeMock).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByTestId('push-device-status')).toHaveTextContent('この端末で登録済み'));
});

test('登録の保存に失敗したら失敗を表示し、登録済みにしない', async () => {
  install({ postOk: false });
  render(<PushDeviceRegistration />);
  expect(await status()).toHaveTextContent('未登録');

  fireEvent.click(screen.getByRole('button', { name: 'この端末で通知を受け取る' }));

  expect(await screen.findByText('通知の登録に失敗しました。時間をおいて再度お試しください。')).toBeInTheDocument();
  // ブラウザ側は購読できてもサーバーに保存できていないので、登録済みとは表示しない。
  expect(await status()).toHaveTextContent('未登録');
});

test('別の端末が登録されているときは、この端末を登録すると切り替わることを伝える', async () => {
  install({ permission: 'granted', local: null, server: OTHER });
  render(<PushDeviceRegistration />);
  expect(await status()).toHaveTextContent('未登録');
  expect(screen.getByText('別の端末が登録されています。この端末を登録すると、通知はこの端末にだけ届くようになります。')).toBeInTheDocument();
});

test('ブラウザ側に購読があってもサーバーの登録が別の端末なら「未登録」（置き換えられた端末）', async () => {
  install({ permission: 'granted', local: HERE, server: OTHER });
  render(<PushDeviceRegistration />);
  expect(await status()).toHaveTextContent('未登録');
});

test('Service Worker が未登録でも確認中のまま止まらず「未登録」と表示する', async () => {
  install({ noRegistration: true });
  render(<PushDeviceRegistration />);
  expect(await status()).toHaveTextContent('未登録');
});

test('通知がブロックされている端末は案内を出し、登録ボタンを出さない', async () => {
  install({ permission: 'denied' });
  render(<PushDeviceRegistration />);
  expect(await status()).toHaveTextContent('通知がブロックされています');
  expect(screen.getByText(/サイト設定で、このサイトの通知を「許可」/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'この端末で通知を受け取る' })).not.toBeInTheDocument();
});

test('プッシュ通知に対応していない環境（VAPID 未設定など）は「この端末では利用できません」', async () => {
  install({});
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  render(<PushDeviceRegistration />);
  expect(await status()).toHaveTextContent('この端末では利用できません');
  expect(screen.queryByRole('button', { name: 'この端末で通知を受け取る' })).not.toBeInTheDocument();
});

test('登録状況を読めなかったら「確認できませんでした」と再試行を出し、再試行で読み直す', async () => {
  install({ serverError: { code: '08006' } });
  render(<PushDeviceRegistration />);
  expect(await screen.findByText('登録状況を確認できませんでした。')).toBeInTheDocument();
  env.serverError = null;
  fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  expect(await status()).toHaveTextContent('未登録');
});

test('ログイン状態が無ければ「確認できませんでした」を出す', async () => {
  install({});
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    from: jest.fn(),
  });
  render(<PushDeviceRegistration />);
  expect(await screen.findByText('登録状況を確認できませんでした。')).toBeInTheDocument();
});

test('通知設定画面に端末登録の入口がある（トグルだけで届け先が無い状態にしない）', async () => {
  install({});
  const settingsRow = {
    push_on_new_booking: true, push_on_cancel: true, push_on_review: true,
    email_daily_summary: false, email_weekly_report: true,
  };
  (createBrowserSupabaseClient as jest.Mock).mockReturnValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'owner-1' } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve(table === 'facility_notification_settings'
            ? { data: settingsRow, error: null }
            : { data: null, error: null }),
        }),
      }),
    }),
  });
  render(<NotificationSettings facilityId="f1" />);
  expect(await screen.findByRole('button', { name: 'この端末で通知を受け取る' })).toBeInTheDocument();
  expect(screen.getByText('この端末のプッシュ通知')).toBeInTheDocument();
});

test('見出しの階層はページに合わせる（管理画面は h4・マイページは h3）', async () => {
  install({});
  const { unmount } = render(<PushDeviceRegistration />);
  expect(await screen.findByRole('heading', { level: 4, name: 'この端末のプッシュ通知' })).toBeInTheDocument();
  unmount();
  render(<PushDeviceRegistration headingLevel="h3" />);
  expect(await screen.findByRole('heading', { level: 3, name: 'この端末のプッシュ通知' })).toBeInTheDocument();
});

test('登録時にログインが切れていた（401）ら、時間をおくのではなくログインし直すよう案内する', async () => {
  install({});
  fetchMock.mockImplementation(() => Promise.resolve({ ok: false, status: 401 }));
  render(<PushDeviceRegistration />);
  expect(await status()).toHaveTextContent('未登録');
  fireEvent.click(screen.getByRole('button', { name: 'この端末で通知を受け取る' }));
  expect(await screen.findByText('ログインを確認できませんでした。ログインし直してから、もう一度お試しください。')).toBeInTheDocument();
  expect(screen.queryByText('通知の登録に失敗しました。時間をおいて再度お試しください。')).not.toBeInTheDocument();
});
