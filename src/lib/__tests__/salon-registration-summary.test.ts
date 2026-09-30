/** @jest-environment node */
import { readSalonRegistrationSummary } from '../salon-registration-summary';
import { readSalonIntentStatus } from '../salon-submission-intent';
jest.mock('../salon-submission-intent', () => ({ readSalonIntentStatus: jest.fn() }));
const receiptId = '74000000-0000-4000-8000-000000000002';
const intentId = '74000000-0000-4000-8000-000000000001';
const row = { facility_name: 'Synthetic', business_type: 'ヘアサロン', address: '合成住所' };
const maybeSingle = jest.fn(); const eq = jest.fn(() => ({ maybeSingle }));
const select = jest.fn(() => ({ eq })); const from = jest.fn(() => ({ select }));
const db = { from } as unknown as Parameters<typeof readSalonRegistrationSummary>[0];
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(readSalonIntentStatus).mockResolvedValue({ state: 'committed', receiptId });
  maybeSingle.mockResolvedValue({ data: row, error: null });
});
test.each(['unverified', 'unavailable', 'expired', 'uncommitted'] as const)('%s cannot query any applicant row', async state => {
  jest.mocked(readSalonIntentStatus).mockResolvedValue({ state });
  expect(await readSalonRegistrationSummary(db, intentId, 'synthetic-proof')).toEqual({ state });
  expect(from).not.toHaveBeenCalled();
});
test.each(['合成住所', '住'.repeat(500), null])('only a capability-bound receipt returns minimal display fields %#', async address => {
  maybeSingle.mockResolvedValue({ data: { ...row, address }, error: null });
  expect(await readSalonRegistrationSummary(db, intentId, 'synthetic-proof')).toEqual({ state: 'confirmed',
    receiptId, name: row.facility_name, type: row.business_type, area: address ?? '' });
  expect(readSalonIntentStatus).toHaveBeenCalledWith(db, intentId, 'synthetic-proof');
  expect(from).toHaveBeenCalledWith('salons');
  expect(select).toHaveBeenCalledWith('facility_name,business_type,address');
  expect(eq).toHaveBeenCalledWith('id', receiptId);
});
test.each([null, {}, { ...row, facility_name: '' }, { ...row, address: 1 },
  { ...row, business_type: null }, { ...row, email: 'private@example.invalid' }])('malformed or excessive result is not confirmation %#', async data => {
  maybeSingle.mockResolvedValue({ data, error: null });
  expect(await readSalonRegistrationSummary(db, intentId, 'synthetic')).toEqual({ state: 'unavailable' });
});
test('error with data and thrown transport failure remain unconfirmed without exposing details', async () => {
  maybeSingle.mockResolvedValue({ data: row, error: { message: 'PRIVATE' } });
  expect(await readSalonRegistrationSummary(db, intentId, 'synthetic')).toEqual({ state: 'unavailable' });
  maybeSingle.mockRejectedValue(new Error('PRIVATE'));
  expect(await readSalonRegistrationSummary(db, intentId, 'synthetic')).toEqual({ state: 'unavailable' });
});
