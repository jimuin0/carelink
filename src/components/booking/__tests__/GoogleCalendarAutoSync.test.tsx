import { render, screen, waitFor } from '@testing-library/react';
import GoogleCalendarAutoSync from '../GoogleCalendarAutoSync';

jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } }),
}));

const BOOKING = '11111111-1111-4111-8111-111111111111';
const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  sessionStorage.clear();
  (AbortSignal as unknown as { timeout: () => AbortSignal }).timeout = () => new AbortController().signal;
});
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

it('連携していなければ同期せず何も出さない', async () => {
  fetchMock.mockResolvedValueOnce(json({ connected: false }));
  const { container } = render(<GoogleCalendarAutoSync bookingId={BOOKING} />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(container.innerHTML).toBe("");
});

it('連携が切れていれば同期しない', async () => {
  fetchMock.mockResolvedValueOnce(json({ connected: true, isExpired: true }));
  render(<GoogleCalendarAutoSync bookingId={BOOKING} />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('status')).toBeNull();
});

it('連携済みなら自動で同期し、成功を表示して操作IDを片付ける', async () => {
  fetchMock.mockResolvedValueOnce(json({ connected: true, isExpired: false }));
  fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
    const { operationId, bookingId } = JSON.parse(String(init.body));
    expect(bookingId).toBe(BOOKING);
    return json({ ok: true, operationId });
  });
  render(<GoogleCalendarAutoSync bookingId={BOOKING} />);
  expect(await screen.findByText('Googleカレンダーに登録しました。')).toBeTruthy();
  expect(fetchMock.mock.calls[1][0]).toBe('/api/google-calendar/sync');
  expect(sessionStorage.getItem(`carelink-calendar-operation:u1:${BOOKING}:sync`)).toBeNull();
});

it('結果が分からなければ失敗を表示し、先行操作IDを残す', async () => {
  const pending = '22222222-2222-4222-8222-222222222222';
  fetchMock.mockResolvedValueOnce(json({ connected: true, isExpired: false }));
  fetchMock.mockResolvedValueOnce(json({ code: 'CALENDAR_BUSY', pendingOperationId: pending }, 409));
  render(<GoogleCalendarAutoSync bookingId={BOOKING} />);
  expect(await screen.findByText(/登録を確認できませんでした/)).toBeTruthy();
  expect(sessionStorage.getItem(`carelink-calendar-operation:u1:${BOOKING}:sync`)).toBe(pending);
});

it('通信が落ちたら失敗を表示する', async () => {
  fetchMock.mockResolvedValueOnce(json({ connected: true, isExpired: false }));
  fetchMock.mockRejectedValueOnce(new Error('net'));
  render(<GoogleCalendarAutoSync bookingId={BOOKING} />);
  expect(await screen.findByText(/登録を確認できませんでした/)).toBeTruthy();
});

it('連携状態が読めなければ何もしない', async () => {
  fetchMock.mockResolvedValueOnce(json({}, 500));
  const { container } = render(<GoogleCalendarAutoSync bookingId={BOOKING} />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(container.innerHTML).toBe("");
});
