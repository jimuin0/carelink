/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import WithdrawalSettings from '../WithdrawalSettings';
import ProfileEditPage from '@/app/mypage/profile/page';
import { ACCOUNT_DELETION_NOTICE, FACILITY_RETIREMENT_NOTICE, ACCOUNT_DELETION_BOOKING_GUARD_NOTICE } from '@/lib/account-deletion-policy';
const mockClear = jest.fn(); const mockComplete = jest.fn(); const mockPrepare = jest.fn(); const mockFetch = jest.fn();
jest.mock('@/lib/client-storage', () => ({ clearAccountLocalData: () => mockClear(), LOCAL_DATA_CLEAR_FAILED: 'この端末の下書きの削除を確認できませんでした。' }));
jest.mock('@/lib/client-cleanup-marker', () => ({ completeClientCleanupMarker: () => mockComplete(), prepareClientCleanupMarker: () => mockPrepare() }));
jest.mock('@/components/Modal', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => <section role="dialog">{children}</section> }));
jest.mock('@/components/Toast', () => ({ __esModule: true, default: ({ message }: { message: string }) => <p role="alert">{message}</p> }));
jest.mock('@/hooks/useUnsavedGuard', () => ({ useUnsavedGuard: () => undefined }));
jest.mock('@/lib/line-availability', () => ({ isLineEnabled: () => false }));
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => ({
 auth: { getUser: async () => ({ data: { user: { id: 'synthetic' } }, error: null }) },
 from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { display_name: 'Synthetic profile', phone: '09000000000', prefecture: '東京都', city: '', birth_date: '', gender: '', avatar_url: null, email_unsubscribed: false }, error: null }) }) }) }),
}) }));
beforeEach(() => { jest.clearAllMocks(); mockClear.mockReset().mockResolvedValue(undefined); mockComplete.mockReset(); mockPrepare.mockReset(); mockFetch.mockReset(); global.fetch = mockFetch; });
async function open(kind: 'owner' | 'profile') {
 render(kind === 'owner' ? <WithdrawalSettings /> : <ProfileEditPage />);
 fireEvent.click(await screen.findByRole('button', { name: kind === 'owner' ? '退会する' : 'アカウントを削除する', exact: true }));
 const dialog = screen.getByRole('dialog'); fireEvent.change(within(dialog).getByLabelText('確認コード DELETE を入力'), { target: { value: 'DELETE' } });
 return { submit: () => fireEvent.click(within(dialog).getByRole('button', { name: kind === 'owner' ? '退会する' : '削除する', exact: true })) };
}
test.each(['owner','profile'] as const)('%s cleanup failure visibly blocks the irreversible account HTTP', async kind => {
 mockClear.mockRejectedValue(new Error('synthetic local storage failure')); const ui = await open(kind); ui.submit();
 expect(await screen.findByRole('alert')).toHaveTextContent('アカウントの削除は行っていません');
 expect(mockFetch).not.toHaveBeenCalled(); expect(mockComplete).not.toHaveBeenCalled();
});
test.each(['owner','profile'] as const)('%s cleanup readback must finish before account deletion can begin', async kind => {
 let release!: () => void; mockClear.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
 mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: '本日以降の対象予約が残っています' }) });
 const ui = await open(kind); ui.submit(); await waitFor(() => expect(mockClear).toHaveBeenCalledTimes(1));
 expect(mockPrepare).toHaveBeenCalledTimes(1);
 expect(mockPrepare.mock.invocationCallOrder[0]).toBeLessThan(mockClear.mock.invocationCallOrder[0]);
 expect(mockFetch).not.toHaveBeenCalled(); expect(screen.getByLabelText('確認コード DELETE を入力')).toBeDisabled();
 release(); await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
 expect(mockPrepare.mock.invocationCallOrder[0]).toBeLessThan(mockFetch.mock.invocationCallOrder[0]);
 expect(mockFetch).toHaveBeenCalledWith('/api/account/delete', expect.objectContaining({ headers: { 'Content-Type': 'application/json', 'X-CareLink-Client-Cleanup': '1' } }));
 expect(await screen.findByRole('alert')).toHaveTextContent('本日以降の対象予約が残っています');
});
test.each(['owner','profile'] as const)('%s verified deletion with post-response cleanup failure stays confirmed, keeps warning and prevents resend', async kind => {
 mockClear.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('synthetic postcleanup'));
 mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
 const ui = await open(kind); ui.submit(); expect(await screen.findByRole('alert')).toHaveTextContent('アカウントの削除は確認済み');
 expect(screen.getByRole('button', { name: kind === 'owner' ? '退会する' : 'アカウントを削除する', exact: true })).toBeDisabled();
 expect(mockFetch).toHaveBeenCalledTimes(1); expect(mockComplete).not.toHaveBeenCalled();
 expect(screen.getByRole('link', { name: 'トップページへ進む' })).toHaveAttribute('href','/');
});
test.each(['owner','profile'] as const)('%s lost/malformed deletion reply is uncertain rather than success or definite failure', async kind => {
 mockFetch.mockRejectedValue(new Error('lost reply')); const ui = await open(kind); ui.submit();
 expect(await screen.findByRole('alert')).toHaveTextContent('結果を確認できません'); expect(mockComplete).not.toHaveBeenCalled();
 expect(mockPrepare).toHaveBeenCalledTimes(1);
});
test.each(['owner','profile'] as const)('%s shared-fence write/readback failure blocks account deletion before HTTP', async kind => {
 mockPrepare.mockImplementation(() => { throw new Error('synthetic shared storage failure'); });
 const ui = await open(kind); ui.submit();
 expect(await screen.findByRole('alert')).toHaveTextContent('アカウントの削除は行っていません');
 expect(mockClear).not.toHaveBeenCalled(); expect(mockFetch).not.toHaveBeenCalled();
});
test('owner retirement display uses the same scoped account, remaining-owner and date/status rules as the platform policy', () => {
 render(<WithdrawalSettings />);
 expect(screen.getByText(ACCOUNT_DELETION_NOTICE)).toBeInTheDocument();
 expect(screen.getByText(FACILITY_RETIREMENT_NOTICE)).toHaveTextContent('別のオーナーが残る場合');
 expect(screen.getByText(ACCOUNT_DELETION_BOOKING_GUARD_NOTICE)).toHaveTextContent('本日以降');
 expect(screen.getByText(ACCOUNT_DELETION_BOOKING_GUARD_NOTICE)).toHaveTextContent('確認待ち・確定・来店済み');
 expect(screen.queryByText(/個人データが完全に削除/)).not.toBeInTheDocument();
});
