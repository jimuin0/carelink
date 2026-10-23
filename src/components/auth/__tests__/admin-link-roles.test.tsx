/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuthButton from '../AuthButton';

// ヘッダーのユーザーメニューの「管理画面」は、/admin に入れる owner/admin だけに出す。
// 以前は所属行の有無だけを見ており、staff/viewer にも出ていた（押すと権限エラーに戻されるだけ）。
const mockMembership = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }), usePathname: () => '/search' }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => ({
  auth: {
    getUser: async () => ({ data: { user: { id: 'synthetic', email: 'synthetic@example.invalid', user_metadata: {} } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
  },
  from: (table: string) => ({ select: (columns: string) => ({ eq: (_c: string, userId: string) => ({
    in: (column: string, roles: string[]) => ({ limit: () => ({ maybeSingle: async () => mockMembership({ table, columns, userId, column, roles }) }) }),
  }) }) }),
}) }));

async function openMenu() {
  render(<AuthButton />);
  fireEvent.click(await screen.findByRole('button', { name: 'ユーザーメニュー' }));
}

test('owner/admin の所属があれば「管理画面」を出し、照会は owner/admin に絞る', async () => {
  mockMembership.mockResolvedValue({ data: { role: 'admin' }, error: null });
  await openMenu();
  expect(await screen.findByRole('link', { name: '管理画面' })).toHaveAttribute('href', '/admin');
  expect(mockMembership).toHaveBeenCalledWith({ table: 'facility_members', columns: 'role', userId: 'synthetic', column: 'role', roles: ['owner', 'admin'] });
});

test('staff/viewer だけ（owner/admin の行が無い）なら「管理画面」を出さない', async () => {
  mockMembership.mockResolvedValue({ data: null, error: null });
  await openMenu();
  await waitFor(() => expect(mockMembership).toHaveBeenCalled());
  expect(screen.queryByRole('link', { name: '管理画面' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'マイページ' })).toBeInTheDocument();
});

test('所属の取得に失敗したときも出さない', async () => {
  mockMembership.mockResolvedValue({ data: { role: 'owner' }, error: { message: 'unavailable' } });
  await openMenu();
  await waitFor(() => expect(mockMembership).toHaveBeenCalled());
  expect(screen.queryByRole('link', { name: '管理画面' })).not.toBeInTheDocument();
});
