/**
 * リマインダー設定の読み取り失敗・部分保存（監査 A62）。
 * 以前は読み取りの error を見ず全項目 false で描画し、無料の 7日前メールを切り替えると
 * 全列を false で upsert して、保存済みの 3日前・LINE の設定を消していた。
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReminderUpsellSettings from '../ReminderUpsellSettings';

const mockUpsert = jest.fn();
let upsertImpl: () => Promise<unknown> = () => Promise.resolve({ error: null });
let settingsResult: { data: unknown; error: unknown };
let entitlementResult: { data: unknown; error: unknown };

jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q; q.eq = () => q;
      q.maybeSingle = () => Promise.resolve(settingsResult);
      q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(entitlementResult).then(resolve);
      q.upsert = (...args: unknown[]) => { mockUpsert(table, ...args); return upsertImpl(); };
      return q;
    },
  }),
}));

beforeEach(() => {
  mockUpsert.mockReset();
  upsertImpl = () => Promise.resolve({ error: null });
  settingsResult = { data: { remind_7d_email: false, remind_3d_email: true, remind_7d_line: true, remind_3d_line: true }, error: null };
  entitlementResult = { data: [], error: null };
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ options: [] }) })) as unknown as typeof fetch;
});

test.each(['settings', 'entitlements'])('%s を読めなかったら切り替えを出さず失敗を表示する', async (which) => {
  if (which === 'settings') settingsResult = { data: null, error: { message: 'db down' } };
  else entitlementResult = { data: null, error: { message: 'db down' } };
  render(<ReminderUpsellSettings facilityId="f1" />);
  expect((await screen.findByRole('alert')).textContent).toContain('リマインダー設定の読み込みに失敗しました');
  expect(screen.queryByRole('switch')).toBeNull();
});

test('切り替えた列だけを保存し、他の保存済み設定を上書きしない', async () => {
  render(<ReminderUpsellSettings facilityId="f1" />);
  fireEvent.click(await screen.findByRole('switch', { name: '7日前リマインドメール' }));
  await waitFor(() => expect(mockUpsert).toHaveBeenCalled());
  expect(mockUpsert).toHaveBeenCalledWith('facility_reminder_settings', { facility_id: 'f1', remind_7d_email: true }, { onConflict: 'facility_id' });
});

// 監査 A267: 保存が例外（通信断）で終わると saving が戻らずトグルが固まり、楽観更新の ON も残った。
test('保存が通信断ならトグルを元に戻し、押せる状態に戻して失敗を出す', async () => {
  upsertImpl = () => Promise.reject(new TypeError('Failed to fetch'));
  render(<ReminderUpsellSettings facilityId="f1" />);
  const toggle = await screen.findByRole('switch', { name: '7日前リマインドメール' });
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(toggle);
  expect(await screen.findByText('設定の保存に失敗しました。時間をおいて再度お試しください。')).toBeTruthy();
  await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
  expect(toggle.getAttribute('aria-checked')).toBe('false');
});

// 2026年11月14日：PAY.JP の月額オプションを店舗が自分で解約できるようにした。
describe('有料オプションの解約', () => {
  const OPTION = { key: 'reminder_line', name: 'LINEリマインド', description: null, monthly_price: 1500, contact_only: false, sort_order: 1 };
  function mockFetch(subStatus: string, cancelOk = true) {
    const calls: Array<[string, RequestInit | undefined]> = [];
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (url.startsWith('/api/options/catalog')) return { ok: true, json: async () => ({ options: [OPTION], publicKey: 'pk' }) };
      if (url.startsWith('/api/options/subscription?')) return { ok: true, json: async () => ({ subscriptions: [{ option_key: 'reminder_line', status: subStatus, current_period_end: '2026-12-14T00:00:00Z' }] }) };
      return cancelOk ? { ok: true, json: async () => ({ canceled: true, periodEnd: '2026-12-14T00:00:00Z' }) } : { ok: false, json: async () => ({ error: '解約できる契約がありません' }) };
    }) as unknown as typeof fetch;
    return calls;
  }
  beforeEach(() => { entitlementResult = { data: [{ option_key: 'reminder_line' }], error: null }; });

  test('利用中のオプションは確認のうえ解約でき、解約予約済みの表示に変わる', async () => {
    const calls = mockFetch('active');
    render(<ReminderUpsellSettings facilityId="f1" />);
    fireEvent.click(await screen.findByRole('button', { name: '解約' }));
    fireEvent.click(await screen.findByRole('button', { name: '解約する' }));
    expect(await screen.findByTestId('canceling-reminder_line')).toBeTruthy();
    const post = calls.find(([u, i]) => u === '/api/options/subscription' && i?.method === 'POST')!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ facilityId: 'f1', optionKey: 'reminder_line' });
    expect(screen.getByRole('status').textContent).toContain('解約を受け付けました');
  });

  test('解約予約済みなら解約ボタンを出さない', async () => {
    mockFetch('canceled');
    render(<ReminderUpsellSettings facilityId="f1" />);
    expect((await screen.findByTestId('canceling-reminder_line')).textContent).toContain('解約予約済み');
    expect(screen.queryByRole('button', { name: '解約' })).toBeNull();
  });

  test('解約に失敗したらエラーを出し、利用中のまま', async () => {
    mockFetch('active', false);
    render(<ReminderUpsellSettings facilityId="f1" />);
    fireEvent.click(await screen.findByRole('button', { name: '解約' }));
    fireEvent.click(await screen.findByRole('button', { name: '解約する' }));
    expect((await screen.findByRole('alert')).textContent).toContain('解約できる契約がありません');
    expect(screen.queryByTestId('canceling-reminder_line')).toBeNull();
  });
});
