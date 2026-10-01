/** @jest-environment node */
import { listSalonRecovery, prepareSalonRecovery, readSalonRecovery, salonRecoveryCookieName, salonRecoveryInput } from '../salon-recovery';
import { businessTypes } from '../constants';
import { salonIntentProofHash } from '../salon-submission-proof';
import type { createServiceRoleClient } from '../supabase-server';
const user = '77000000-0000-4000-8000-000000000001';
const receiptId = '78000000-0000-4000-8000-000000000001';
const grant = '79000000-0000-4000-8000-000000000001';
const proof = 'ab'.repeat(32);
const rpc = jest.fn();
const db = { rpc } as unknown as ReturnType<typeof createServiceRoleClient>;
const row = { receipt_id: receiptId, facility_name: 'Synthetic', business_type: businessTypes[0], created_at: '2026-10-01T00:00:00+00:00' };
beforeEach(() => { rpc.mockReset(); jest.useFakeTimers().setSystemTime(new Date('2026-10-01T00:00:00Z')); });
afterEach(() => jest.useRealTimers());
test('cookie only accepts an opaque UUID selector', () => {
  expect(salonRecoveryCookieName(grant)).toBe('carelink_salon_recovery_' + grant);
  expect(() => salonRecoveryCookieName('invalid')).toThrow('Invalid recovery selector');
});
test.each([{}, null, { action: 'list', email: 'synthetic@example.invalid' }, { action: 'list', after: 'bad' },
  { action: 'prepare', receiptId }, { action: 'summary', recoveryId: grant }])('input is allowlisted %#', value => {
  expect(salonRecoveryInput.safeParse(value).success).toBe(Boolean(value && ('receiptId' in value || 'recoveryId' in value)));
});
test('zero matches is distinct from provider failure and uses current account only', async () => {
  rpc.mockResolvedValue({ data: [], error: null });
  expect(await listSalonRecovery(db, user)).toEqual({ state: 'ready', receipts: [], next: null });
  expect(rpc).toHaveBeenCalledWith('list_recoverable_salon_receipts', { p_user_id: user });
  rpc.mockResolvedValue({ data: [], error: { code: '42501', message: 'REGISTRATION_ACCOUNT_UNVERIFIED' } });
  expect(await listSalonRecovery(db, user)).toEqual({ state: 'unverified' });
  rpc.mockResolvedValue({ data: [], error: { code: '08006', message: 'PRIVATE' } });
  await expect(listSalonRecovery(db, user)).rejects.toThrow('Registration recovery list unavailable');
  rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for function' } });
  await expect(listSalonRecovery(db, user)).rejects.toThrow('Registration recovery list unavailable');
});
test('the 51st row indicates a next page after the 50th, not silent truncation', async () => {
  const rows = Array.from({ length: 51 }, (_, index) => ({ ...row, receipt_id: `78000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` }));
  rpc.mockResolvedValue({ data: rows, error: null });
  expect(await listSalonRecovery(db, user, receiptId)).toEqual({ state: 'ready', receipts: rows.slice(0, 50), next: rows[49].receipt_id });
  expect(rpc.mock.calls[0][1].p_after_id).toBe(receiptId);
  rpc.mockResolvedValue({ data: [{ ...row, created_at: null }], error: null });
  expect(await listSalonRecovery(db, user)).toMatchObject({ next: null, receipts: [{ created_at: null }] });
});
test.each([null, {}, Array(52).fill(row), [{ ...row, receipt_id: 'bad' }], [{ ...row, business_type: 'bad' }],
  [{ ...row, email: 'private@example.invalid' }], [{ ...row, created_at: 'invalid' }]])('bad list is not no matches %#', async data => {
  rpc.mockResolvedValue({ data, error: null });
  await expect(listSalonRecovery(db, user)).rejects.toThrow('Invalid registration recovery list');
});
test('prepared grant is bound to the chosen receipt, user and digest, not raw proof', async () => {
  rpc.mockResolvedValue({ data: [{ outcome: 'prepared', grant_id: grant, expires_at: '2026-10-04T00:00:00Z' }], error: null });
  expect(await prepareSalonRecovery(db, user, receiptId, grant, proof)).toEqual({ state: 'prepared', recoveryId: grant, expiresAt: '2026-10-04T00:00:00Z' });
  expect(rpc).toHaveBeenCalledWith('prepare_salon_recovery', { p_user_id: user, p_receipt_id: receiptId, p_grant_id: grant, p_proof_hash: salonIntentProofHash(proof) });
  expect(JSON.stringify(rpc.mock.calls)).not.toContain(proof);
});
test('explicit refusal remains refusal', async () => {
  rpc.mockResolvedValue({ data: [{ outcome: 'unverified', grant_id: null, expires_at: null }], error: null });
  expect(await prepareSalonRecovery(db, user, receiptId, grant, proof)).toEqual({ state: 'unverified' });
});
test.each([{ data: null, error: null }, { data: {}, error: null }, { data: [], error: null }, { data: [{}, {}], error: null }, { data: [], error: { message: 'PRIVATE' } }])('prepare ambiguity never becomes usable grant %#', async response => {
  rpc.mockResolvedValue(response);
  await expect(prepareSalonRecovery(db, user, receiptId, grant, proof)).rejects.toThrow('Registration recovery preparation unavailable');
});
test.each([{}, { outcome: 'prepared', grant_id: receiptId, expires_at: '2026-10-04T00:00:00Z' },
  { outcome: 'prepared', grant_id: grant, expires_at: '2026-10-01T00:00:00Z' },
  { outcome: 'prepared', grant_id: grant, expires_at: '2026-10-05T00:00:00Z' }])('invalid preparation contract is rejected %#', async row => {
  rpc.mockResolvedValue({ data: [row], error: null });
  await expect(prepareSalonRecovery(db, user, receiptId, grant, proof)).rejects.toThrow('Invalid registration recovery preparation');
});
test.each([null, '合成住所'])('summary is minimal and retains address %#', async address => {
  rpc.mockResolvedValue({ data: [{ outcome: 'confirmed', receipt_id: receiptId, facility_name: row.facility_name, business_type: row.business_type, address }], error: null });
  expect(await readSalonRecovery(db, user, grant, proof)).toEqual({ state: 'confirmed', receiptId, name: row.facility_name, type: row.business_type, address });
  expect(rpc).toHaveBeenCalledWith('read_salon_recovery', { p_user_id: user, p_grant_id: grant, p_proof_hash: salonIntentProofHash(proof) });
});
test('summary refusal does not carry applicant fields', async () => {
  rpc.mockResolvedValue({ data: [{ outcome: 'unverified', receipt_id: null, facility_name: null, business_type: null, address: null }], error: null });
  expect(await readSalonRecovery(db, user, grant, proof)).toEqual({ state: 'unverified' });
});
test.each([{ data: null, error: null }, { data: {}, error: null }, { data: [], error: null }, { data: [{}, {}], error: null }, { data: [], error: { message: 'PRIVATE' } }])('summary provider failure is not refusal or success %#', async response => {
  rpc.mockResolvedValue(response);
  await expect(readSalonRecovery(db, user, grant, proof)).rejects.toThrow('Registration recovery summary unavailable');
});
test.each([{}, { outcome: 'confirmed', receipt_id: receiptId, facility_name: row.facility_name, business_type: 'bad', address: null }])('summary wrong contract fails closed %#', async value => {
  rpc.mockResolvedValue({ data: [value], error: null });
  await expect(readSalonRecovery(db, user, grant, proof)).rejects.toThrow('Invalid registration recovery summary');
});
