/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import NewBookingListener from '../NewBookingListener';

const FACILITY = '76000000-0000-4000-8000-000000000001';
const OTHER = '76000000-0000-4000-8000-000000000002';
const booking = (id: string, name: string) => ({ id, customer_name: name, booking_date: '2026-10-23', start_time: '09:00:00', created_at: '2026-10-21T10:00:00Z' });
const ok = (bookings: unknown[], now = '2026-10-21T10:00:00.000Z') => ({ ok: true, status: 200, json: async () => ({ now, bookings }) });
const fetchMock = jest.fn();

async function flush() { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); }
async function advance(ms: number) { await act(async () => { jest.advanceTimersByTime(ms); }); await flush(); }
function setVisibility(state: 'visible' | 'hidden') { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state }); }

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  setVisibility('visible');
});
afterEach(() => { jest.useRealTimers(); });

test('the first check only primes; a later new booking is shown once', async () => {
  fetchMock.mockResolvedValueOnce(ok([booking('old', '既存 花子')]))
    .mockResolvedValueOnce(ok([booking('old', '既存 花子'), booking('new', '合成 太郎')], '2026-10-21T10:01:00.000Z'))
    .mockResolvedValueOnce(ok([booking('new', '合成 太郎')], '2026-10-21T10:02:00.000Z'));
  render(<NewBookingListener facilityId={FACILITY} />);
  await flush();
  expect(screen.queryByText(/既存 花子/)).not.toBeInTheDocument();
  expect(fetchMock.mock.calls[0][0]).toBe(`/api/admin/bookings/recent?facility_id=${FACILITY}`);
  await advance(60_000);
  expect(screen.getByText(/合成 太郎様 2026-10-23 09:00〜/)).toBeInTheDocument();
  expect(fetchMock.mock.calls[1][0]).toContain(`since=${encodeURIComponent('2026-10-21T09:58:00.000Z')}`);
  await advance(60_000);
  expect(screen.getAllByText(/合成 太郎様/)).toHaveLength(1);
});

test.each([
  [401, 'ログインが切れたため、新規予約の確認を止めました。再ログインしてください。'],
  [403, 'この店舗の予約を確認する権限がないため、新規予約の確認を止めました。'],
])('HTTP %s is shown and checking stops', async (status, message) => {
  fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({}) });
  render(<NewBookingListener facilityId={FACILITY} />);
  await flush();
  expect(screen.getByRole('status')).toHaveTextContent(message);
  await advance(180_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test.each([
  ['server error', () => fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })],
  ['network failure', () => fetchMock.mockRejectedValueOnce(new Error('offline'))],
  ['malformed body', () => fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ bookings: 'x' }) })],
  ['invalid JSON', () => fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('bad'); } })],
])('%s is reported as a failed check, not "no new bookings", and retried', async (_label, arrange) => {
  arrange();
  fetchMock.mockResolvedValue(ok([]));
  render(<NewBookingListener facilityId={FACILITY} />);
  await flush();
  expect(screen.getByRole('status')).toHaveTextContent('新規予約を確認できませんでした。自動で再試行しています。');
  await advance(60_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('hidden tabs skip the request; returning to the tab or coming back online checks at once', async () => {
  fetchMock.mockResolvedValue(ok([]));
  render(<NewBookingListener facilityId={FACILITY} />);
  await flush();
  setVisibility('hidden');
  await advance(60_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await flush();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  setVisibility('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await flush();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await act(async () => { window.dispatchEvent(new Event('online')); });
  await flush();
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test('switching facility aborts the previous request and never shows its bookings', async () => {
  let resolveFirst: (v: unknown) => void = () => {};
  const signals: AbortSignal[] = [];
  fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => { signals.push(init.signal!); return new Promise(r => { resolveFirst = r; }); })
    .mockResolvedValue(ok([]));
  const { rerender } = render(<NewBookingListener key={FACILITY} facilityId={FACILITY} />);
  rerender(<NewBookingListener key={OTHER} facilityId={OTHER} />);
  await flush();
  expect(signals[0].aborted).toBe(true);
  resolveFirst(ok([booking('stale', '前店舗 客')]));
  await flush();
  expect(screen.queryByText(/前店舗/)).not.toBeInTheDocument();
  expect(fetchMock.mock.calls[1][0]).toBe(`/api/admin/bookings/recent?facility_id=${OTHER}`);
  await advance(120_000);
  expect(fetchMock.mock.calls.every(([url], i) => i === 0 || String(url).includes(OTHER))).toBe(true);
});
