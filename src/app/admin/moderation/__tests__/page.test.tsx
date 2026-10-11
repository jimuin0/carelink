/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ModerationPage from '../page';
const id = '11111111-1111-4111-8111-111111111111';
const mockFetch = jest.fn(); const mockDb = jest.fn();
const actions = () => within(screen.getByPlaceholderText('審査メモ（任意）').parentElement!);
jest.mock('@/lib/supabase-browser', () => ({ createBrowserSupabaseClient: () => mockDb() }));
jest.mock('@/components/Toast', () => ({ __esModule: true, default: ({ message }: { message: string }) => <p role="status">{message}</p> }));
beforeEach(() => {
 jest.clearAllMocks(); global.fetch = mockFetch;
 mockFetch.mockResolvedValue({ ok: true });
 mockDb.mockImplementation(() => {
  const result = { data: [{ id, content_type: 'review', content_id: id, facility_id: null,
   report_reason: 'Synthetic report', auto_flags: [], status: 'pending', review_note: null, reviewed_at: null, created_at: '2026-10-08T00:00:00Z' }], error: null };
  const chain = { select: () => chain, order: () => chain, limit: () => chain, eq: () => chain,
   then: (resolve: (value: typeof result) => void) => Promise.resolve(result).then(resolve) }; return { from: () => chain };
 });
});
test('moderation request carries the original displayed status alongside decision/note', async () => {
 render(<ModerationPage />); fireEvent.click(await screen.findByRole('button', { name: '審査する' }));
 fireEvent.change(screen.getByPlaceholderText('審査メモ（任意）'), { target: { value: 'Synthetic decision' } });
 fireEvent.click(actions().getByRole('button', { name: '却下', exact: true }));
 await screen.findByText('却下しました');
 expect(mockFetch).toHaveBeenCalledWith(`/api/admin/moderation/${id}`, expect.objectContaining({ body: JSON.stringify({ decision: 'rejected', expected_status: 'pending', expected_reviewed_at: null, review_note: 'Synthetic decision' }) }));
});
test('lost response followed by competing decision leaves original expected status and requires reload', async () => {
 mockFetch.mockRejectedValueOnce(new Error('lost reply')).mockResolvedValueOnce({ ok: false, status: 409 });
 render(<ModerationPage />); fireEvent.click(await screen.findByRole('button', { name: '審査する' }));
 fireEvent.click(actions().getByRole('button', { name: '承認', exact: true }));
 await screen.findByText('審査結果を確認できませんでした。メモは保持されています。再読み込みして状態を確認してください');
 await waitFor(() => expect(actions().getByRole('button', { name: '承認', exact: true })).toBeEnabled());
 fireEvent.click(actions().getByRole('button', { name: '承認', exact: true }));
 await screen.findByText('審査状態が変更されています。再読み込みして確認してください');
 expect(mockFetch).toHaveBeenCalledTimes(2);
 for (const [, init] of mockFetch.mock.calls) expect(JSON.parse(init.body).expected_status).toBe('pending');
 expect(screen.queryByText('承認しました')).not.toBeInTheDocument();
});
