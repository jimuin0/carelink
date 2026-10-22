import { render, screen, fireEvent, within } from '@testing-library/react';
import Page from '../page';

// HPB 一括反映のメニューは非公開で作られる。以前は「メニュー編集で公開ON」と案内していたが、
// メニュー管理には公開の手段が無かった。反映後に公開の手順と行き先を示すことを固定する。
const facility = '00000000-0000-4000-8000-000000000002';
const mockAuth = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => ({ auth: { getUser: mockAuth }, from: mockFrom }) }));

let applyResult: { ok: boolean; body: unknown };

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ data: { user: { id: 'synthetic-user' } } });
  mockFrom.mockImplementation((table: string) => {
    const q: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'limit']) q[method] = jest.fn(() => q);
    q.single = jest.fn(() => Promise.resolve(table === 'facility_members'
      ? { data: { facility_id: facility }, error: null }
      : { data: { hpb_sln_id: 'H000000001' }, error: null }));
    return q;
  });
  applyResult = { ok: true, body: { inserted: 3, updated: 1, hidden: 0, skipped: 0 } };
  global.fetch = jest.fn().mockImplementation((url: string, options?: RequestInit) => {
    if (options?.method === 'POST' && url.includes('/apply')) {
      return Promise.resolve({ ok: applyResult.ok, json: async () => applyResult.body });
    }
    return Promise.resolve({ ok: true, json: async () => ({ menus: [{ facility_id: facility, ref_id: 'r1', kind: 'menu', store_id: 's', name: '合成カット', target: null, duration_min: 60, price: 4000, description: null, name_override: null, duration_min_override: null, price_override: null, description_override: null, is_hidden: false }] }) });
  });
});

test('反映前から、公開はメニュー管理で行うことを選択中の店舗へのリンクつきで示す', async () => {
  render(<Page />);
  await screen.findByText('合成カット');
  const link = screen.getByRole('link', { name: 'メニュー管理' });
  expect(link.getAttribute('href')).toBe(`/admin/menus?facility_id=${facility}`);
  expect(link.parentElement?.textContent).toContain('「公開する」を押すまでお客様には表示されません');
});

test('新規メニューを反映したら、非公開であることと公開の手順を画面に残す', async () => {
  render(<Page />);
  await screen.findByText('合成カット');
  fireEvent.click(screen.getByRole('button', { name: 'お客様メニューへ一括反映' }));
  const toast = await screen.findByText(/メニューへ反映: 新規3件/);
  expect(toast.textContent).toContain('メニュー管理で「公開する」を押すと、お客様に表示されネット予約できるようになります');
  const next = screen.getByText(/新しく反映したメニュー3件は非公開です/);
  expect(within(next).getByRole('link', { name: 'メニュー管理' }).getAttribute('href')).toBe(`/admin/menus?facility_id=${facility}`);
});

test('新規が無い反映では公開の手順を出さない', async () => {
  applyResult = { ok: true, body: { inserted: 0, updated: 2, hidden: 0, skipped: 0 } };
  render(<Page />);
  await screen.findByText('合成カット');
  fireEvent.click(screen.getByRole('button', { name: 'お客様メニューへ一括反映' }));
  const toast = await screen.findByText(/メニューへ反映: 新規0件/);
  expect(toast.textContent).not.toContain('公開する');
  expect(screen.queryByText(/新しく反映したメニュー/)).toBeNull();
});

test('反映に失敗したら公開の手順を出さない', async () => {
  applyResult = { ok: false, body: { error: '反映に失敗しました' } };
  render(<Page />);
  await screen.findByText('合成カット');
  fireEvent.click(screen.getByRole('button', { name: 'お客様メニューへ一括反映' }));
  await screen.findByText('反映に失敗しました');
  expect(screen.queryByText(/新しく反映したメニュー/)).toBeNull();
});
