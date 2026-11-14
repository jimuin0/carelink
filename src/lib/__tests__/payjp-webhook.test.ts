/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
const mockFeatured = jest.fn();
const mockOption = jest.fn();
const mockBooking = jest.fn();
jest.mock('../featured-ads-payjp', () => ({ applyPayjpEvent: (...a: unknown[]) => mockFeatured(...a) }));
jest.mock('../options-payjp', () => ({ applyOptionSubscription: (...a: unknown[]) => mockOption(...a) }));
jest.mock('../booking-payjp', () => ({ applyBookingChargeEvent: (...a: unknown[]) => mockBooking(...a) }));
import { applyPayjpWebhookEvent } from '../payjp-webhook';

const admin = {} as never;
beforeEach(() => { mockFeatured.mockResolvedValue('applied'); mockOption.mockResolvedValue('applied'); mockBooking.mockResolvedValue('ignored'); });

test('option_key のある定期課金は有料オプションへ', async () => {
  const ev = { id: 'evnt_1', type: 'subscription.renewed', created: 100, data: { object: 'subscription', id: 'sub_1', status: 'active', current_period_end: 200, metadata: { option_key: 'reminder_line', facility_id: 'f1' } } };
  expect(await applyPayjpWebhookEvent(admin, ev)).toBe('applied');
  expect(mockOption).toHaveBeenCalledWith(admin, 'subscription.renewed', { id: 'sub_1', status: 'active', current_period_end: 200, metadata: ev.data.metadata }, new Date(100_000));
  expect(mockFeatured).not.toHaveBeenCalled();
});
test('option_key のある定期課金で形が違えば throw', async () => {
  await expect(applyPayjpWebhookEvent(admin, { id: 'evnt_1', type: 'subscription.created', created: 1, data: { object: 'charge', id: 'sub_1', metadata: { option_key: 'x' } } })).rejects.toThrow(/subscription object/);
  await expect(applyPayjpWebhookEvent(admin, { id: 'evnt_1', type: 'subscription.created', created: 1, data: { object: 'subscription', metadata: { option_key: 'x' } } })).rejects.toThrow(/subscription object/);
});
test('それ以外の定期課金は広告枠へ（metadata が無くても）', async () => {
  await applyPayjpWebhookEvent(admin, { id: 'evnt_1', type: 'subscription.created', created: 1, data: { object: 'subscription', id: 'sub_1' } });
  await applyPayjpWebhookEvent(admin, { id: 'evnt_2', type: 'subscription.created', created: 1, data: { metadata: { slot_id: 's' } } });
  expect(mockFeatured).toHaveBeenCalledTimes(2);
});
test('subscription 以外は予約の前払いへ', async () => {
  expect(await applyPayjpWebhookEvent(admin, { id: 'evnt_1', type: 'charge.refunded', created: 1, data: { id: 'ch_1' } })).toBe('ignored');
  expect(mockBooking).toHaveBeenCalledWith(admin, expect.objectContaining({ type: 'charge.refunded' }));
});
