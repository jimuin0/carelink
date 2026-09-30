/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegistrationReceipt from './RegistrationReceipt';
import { SALON_BROWSER_CONTEXT_KEY, salonHandoffAuthPath } from '@/lib/salon-browser-context';
const intentId = '74000000-0000-4000-8000-000000000001';
const receiptId = '74000000-0000-4000-8000-000000000002';
const summary = { state: 'confirmed', receiptId, name: '<script>合成店舗</script>', type: 'ヘアサロン', area: '' };
const fetchMock = jest.fn();
beforeEach(() => {
  jest.clearAllMocks(); window.sessionStorage.clear();
  window.sessionStorage.setItem(SALON_BROWSER_CONTEXT_KEY, JSON.stringify({ version: 1, intentId, phase: 'attempted' }));
  fetchMock.mockResolvedValue({ ok: true, json: async () => summary });
  global.fetch = fetchMock;
});
test('confirmed receipt is checked server-side before display and carries only a mode marker through auth', async () => {
  render(<RegistrationReceipt />);
  await screen.findByText('掲載申込を受け付けました');
  expect(screen.getByText(summary.name)).toBeVisible();
  expect(screen.getByText(receiptId)).toBeVisible();
  expect(screen.getByText(/一般公開は完了していません/)).toBeVisible();
  expect(fetchMock.mock.calls[0][0]).toBe('/api/salons/summary');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ intentId });
  expect(screen.getByRole('link', { name: '店舗アカウントを作成する' })).toHaveAttribute('href', salonHandoffAuthPath('signup'));
  expect(screen.getByRole('link', { name: '既存アカウントでログインする' })).toHaveAttribute('href', salonHandoffAuthPath('login'));
  const next = screen.getByRole('link', { name: '別の店舗を新しいタブで申し込む' });
  expect(next).toHaveAttribute('target', '_blank'); expect(next).toHaveAttribute('rel', 'noopener noreferrer');
  expect(JSON.parse(window.sessionStorage.getItem(SALON_BROWSER_CONTEXT_KEY)!)).toEqual({ version: 1, intentId, phase: 'confirmed' });
});
test.each(['missing', 'broken'])('unavailable context never fabricates receipt or queries other cookies %s', async kind => {
  if (kind === 'missing') window.sessionStorage.clear();
  else window.sessionStorage.setItem(SALON_BROWSER_CONTEXT_KEY, '{');
  render(<RegistrationReceipt />);
  await screen.findByRole('alert'); expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.queryByText('掲載申込を受け付けました')).not.toBeInTheDocument();
});
test.each([
  { ok: false, body: summary }, { ok: true, body: { state: 'uncommitted' } },
  { ok: true, body: { ...summary, receiptId: 'bad' } }, { ok: true, body: { ...summary, name: '' } },
])('invalid HTTP/business result never renders success %#', async ({ ok, body }) => {
  fetchMock.mockResolvedValue({ ok, json: async () => body });
  render(<RegistrationReceipt />); await screen.findByRole('alert');
  expect(screen.queryByText('掲載申込を受け付けました')).not.toBeInTheDocument();
});
test('retry rechecks the same intent and does not prepare/commit another submission', async () => {
  fetchMock.mockRejectedValueOnce(new Error('synthetic network failure'));
  render(<RegistrationReceipt />); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '同じ申込の受付状況を確認' }));
  await screen.findByText('掲載申込を受け付けました');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  for (const [url, init] of fetchMock.mock.calls) {
    expect(url).toBe('/api/salons/summary'); expect(JSON.parse(init.body)).toEqual({ intentId });
  }
});
test('a stale response cannot overwrite another selection', async () => {
  let finish!: (value: unknown) => void;
  fetchMock.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<RegistrationReceipt />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const other = JSON.stringify({ version: 1, intentId: receiptId, phase: 'prepared' });
  window.sessionStorage.setItem(SALON_BROWSER_CONTEXT_KEY, other);
  finish({ ok: true, json: async () => summary });
  await screen.findByRole('alert');
  expect(window.sessionStorage.getItem(SALON_BROWSER_CONTEXT_KEY)).toBe(other);
});
