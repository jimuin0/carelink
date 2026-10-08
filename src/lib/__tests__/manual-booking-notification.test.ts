/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
jest.mock('../email', () => ({ buildBookingConfirmedEnvelope: jest.fn(() => ({
  from: 'CareLink <noreply@carelink-jp.com>', to: 'synthetic@example.invalid', subject: '予約', html: '<p>予約</p>',
})) }));
import { prepareManualBookingEnvelope } from '../manual-booking-notification';
import { buildBookingConfirmedEnvelope } from '../email';
const OP = '88888888-8888-4888-8888-888888888888', FAC = '22222222-2222-4222-8222-222222222222';
const envelope = { from: 'CareLink <noreply@carelink-jp.com>', to: 'synthetic@example.invalid', subject: '予約', html: '<p>予約</p>' };
const job = { id: OP, target_id: OP, webhook_type: 'manual_booking_confirmation', facility_id: FAC,
  claimed_at: '2026-10-01T00:00:00Z', email_envelope: null, payload: { operation_id: OP, template_version: 1 } };
const original = { facility_id: FAC, booking_id: OP, input: { facility_id: FAC, email: envelope.to,
  customer_name: 'Synthetic', booking_date: '2030-01-01', start_time: '10:00', end_time: '11:00' },
  result: { total_price: 6000, menu_names: 'Second、First', facility_name: 'Synthetic', staff_name: null } };
let chain: Record<string, jest.Mock>, from: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks(); chain = {};
  for (const key of ['select','eq','update','is']) chain[key] = jest.fn(() => chain);
  chain.maybeSingle = jest.fn().mockResolvedValueOnce({ data: original, error: null }).mockResolvedValue({ data: { id: OP }, error: null });
  from = jest.fn(() => chain);
});
test('frozen envelope is reused without reading or rewriting current booking/catalog', async () => {
  expect(await prepareManualBookingEnvelope({ from } as never, { ...job, email_envelope: envelope })).toEqual(envelope);
  expect(from).not.toHaveBeenCalled(); expect(buildBookingConfirmedEnvelope).not.toHaveBeenCalled();
});
test('immutable operation is resolved and frozen under the original claim before dispatch', async () => {
  expect(await prepareManualBookingEnvelope({ from } as never, job)).toEqual(envelope);
  expect(buildBookingConfirmedEnvelope).toHaveBeenCalledWith(expect.objectContaining({ totalPrice: 6000,
    menuName: 'Second、First', customerEmail: envelope.to }));
  expect(chain.update).toHaveBeenCalledWith({ email_envelope: envelope });
  expect(chain.eq).toHaveBeenCalledWith('claimed_at', job.claimed_at);
  expect(chain.is).toHaveBeenCalledWith('delivery_started_at', null);
});
test.each([null, { ...original, facility_id: OP }, { ...original, input: { ...original.input, facility_id: OP } },
  { ...original, result: { ...original.result, total_price: -1 } }])('untrusted or missing original fails closed %j', async data => {
  chain.maybeSingle.mockReset().mockResolvedValue({ data, error: null });
  await expect(prepareManualBookingEnvelope({ from } as never, job)).rejects.toThrow();
  expect(chain.update).not.toHaveBeenCalled();
});
test.each([{ data: null, error: {} }, { data: null }, { data: { id: FAC } }])('unconfirmed freeze never dispatches %j', async result => {
  chain.maybeSingle.mockReset().mockResolvedValueOnce({ data: original }).mockResolvedValueOnce(result);
  await expect(prepareManualBookingEnvelope({ from } as never, job)).rejects.toThrow('freeze not confirmed');
});
test('wrong operation linkage or malformed frozen payload is rejected', async () => {
  await expect(prepareManualBookingEnvelope({ from } as never, { ...job, target_id: FAC })).rejects.toThrow();
  await expect(prepareManualBookingEnvelope({ from } as never, { ...job, email_envelope: {} })).rejects.toThrow();
});
