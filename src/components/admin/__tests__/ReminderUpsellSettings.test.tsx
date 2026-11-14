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
