/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuthButton from '../AuthButton';
import AdminUserMenu from '@/components/admin/AdminUserMenu';
import { LOCAL_DATA_CLEAR_FAILED } from '@/lib/client-storage';
const mockClear = jest.fn(); const mockSignOut = jest.fn(); const mockGetUser = jest.fn();
const mockPush = jest.fn(); const mockRefresh = jest.fn(); const mockMark = jest.fn(); const mockComplete = jest.fn();
const router = { push: mockPush, refresh: mockRefresh };
jest.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/search' }));
jest.mock('@/lib/client-storage', () => ({ clearAccountLocalData: () => mockClear(), LOCAL_DATA_CLEAR_FAILED: 'この端末の下書きの削除を確認できませんでした。' }));
jest.mock('@/lib/client-cleanup-marker', () => ({ markClientCleanupNeeded: () => mockMark(), completeClientCleanupMarker: () => mockComplete() }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => ({
 auth: { getUser: mockGetUser, signOut: mockSignOut, onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
 from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
}) }));
const user = { id: 'synthetic', email: 'synthetic@example.invalid', user_metadata: {} };
beforeEach(() => {
 jest.clearAllMocks(); mockClear.mockReset().mockResolvedValue(undefined); mockSignOut.mockReset().mockResolvedValue({ error: null });
 mockGetUser.mockReset().mockResolvedValue({ data: { user }, error: null }); mockMark.mockReset(); mockComplete.mockReset();
});
async function open(kind: 'public' | 'admin') {
 render(kind === 'public' ? <AuthButton /> : <AdminUserMenu />);
 const menu = await screen.findByRole('button', { name: kind === 'public' ? 'ユーザーメニュー' : 'アカウントメニュー' });
 fireEvent.click(menu); fireEvent.click(screen.getByRole('button', { name: 'ログアウト', exact: true }));
}
test.each(['public','admin'] as const)('%s signout resolved error is visible and never navigates as successful logout', async kind => {
 mockSignOut.mockResolvedValue({ error: { message: 'synthetic SDK failure' } }); await open(kind);
 expect(await screen.findByRole('alert')).toHaveTextContent('ログアウトを確認できませんでした');
 expect(mockPush).not.toHaveBeenCalled(); expect(mockRefresh).not.toHaveBeenCalled(); expect(mockComplete).not.toHaveBeenCalled();
});
test.each(['public','admin'] as const)('%s logout still finishes when cleanup fails, keeps the actual warning until explicit action', async kind => {
 mockClear.mockRejectedValue(new Error('synthetic quota')); await open(kind);
 expect(await screen.findByRole('alert')).toHaveTextContent(`ログアウトしましたが、${LOCAL_DATA_CLEAR_FAILED}`);
 expect(mockSignOut).toHaveBeenCalledTimes(1); expect(mockPush).not.toHaveBeenCalled(); expect(mockRefresh).not.toHaveBeenCalled();
 expect(mockMark).toHaveBeenCalled(); expect(mockComplete).not.toHaveBeenCalled();
 expect(screen.getByRole('link', { name: 'ログイン画面へ進む' })).toHaveAttribute('href','/auth/login');
 mockClear.mockResolvedValue(undefined); fireEvent.click(screen.getByRole('button', { name: '端末の下書き削除を再試行' }));
 await waitFor(() => expect(mockPush).toHaveBeenCalledWith(kind === 'public' ? '/search' : '/auth/login'));
 expect(mockComplete).toHaveBeenCalledTimes(1); expect(mockSignOut).toHaveBeenCalledTimes(1);
});
test.each(['public','admin'] as const)('%s clean logout verifies both stores and SDK before navigation', async kind => {
 await open(kind); await waitFor(() => expect(mockPush).toHaveBeenCalledWith(kind === 'public' ? '/search' : '/auth/login'));
 expect(mockClear).toHaveBeenCalledTimes(2); expect(mockMark).toHaveBeenCalledTimes(1); expect(mockComplete).toHaveBeenCalledTimes(1);
 expect(mockRefresh).toHaveBeenCalledTimes(1); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test.each(['public','admin'] as const)('%s marker clear failure remains a visible privacy warning despite authenticated signout success', async kind => {
 mockComplete.mockImplementation(() => { throw new Error('cookie readback failed'); }); await open(kind);
 expect(await screen.findByRole('alert')).toHaveTextContent('下書きの削除を確認できません'); expect(mockPush).not.toHaveBeenCalled();
});
test('public malformed SDK success is unconfirmed and does not claim anonymous state', async () => {
 mockSignOut.mockResolvedValue(undefined); await open('public'); expect(await screen.findByRole('alert')).toHaveTextContent('ログアウトを確認できません'); expect(mockPush).not.toHaveBeenCalled();
});
