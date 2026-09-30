/** @jest-environment node */
import { setupFacilityAtomically, type FacilitySetupClaim } from '../facility-setup-atomic';
import { businessTypes } from '../constants';
import { salonIntentProofHash } from '../salon-submission-proof';
import type { createServiceRoleClient } from '../supabase-server';

const user = '68000000-0000-4000-8000-000000000001';
const receipt = '69000000-0000-4000-8000-000000000001';
const intent = '6a000000-0000-4000-8000-000000000001';
const facility = '67000000-0000-4000-8000-000000000001';
const proof = 'ab'.repeat(32);
const rpc = jest.fn();
const db = { rpc } as unknown as ReturnType<typeof createServiceRoleClient>;
const body = { facility_name: 'Synthetic', business_type: businessTypes[0], license_warranted: true };
beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: [{ outcome: 'created', facility_id: facility, facility_slug: 'synthetic' }], error: null });
});
test.each([null, [], {}, { ...body, license_warranted: false }, { ...body, user_id: user },
  { ...body, facility_name: 7 }, { ...body, facility_name: 'x'.repeat(201) },
  { ...body, business_type: 'wrong' }, { ...body, phone: 'x'.repeat(21) },
  { ...body, prefecture: 'x'.repeat(21) }, { ...body, city: 'x'.repeat(51) },
  { ...body, address: 'x'.repeat(201) },
])('invalid input is rejected before RPC %#', async value => {
  expect(await setupFacilityAtomically(db, user, value, { mode: 'none' })).toEqual({ state: 'invalid' });
  expect(rpc).not.toHaveBeenCalled();
});
test('non-user identifier cannot be persisted', async () => {
  expect(await setupFacilityAtomically(db, 'bad', body, { mode: 'none' })).toEqual({ state: 'invalid' });
  expect(rpc).not.toHaveBeenCalled();
});
test.each([
  [{ ...body, intentId: intent }, { mode: 'none' }],
  [{ ...body, intentId: intent }, { mode: 'legacy', receiptId: receipt, issuedAt: '2026-09-26T00:00:00Z' }],
  [{ ...body, intentId: intent }, { mode: 'intent', intentId: intent, proof: 'bad' }],
  [body, { mode: 'intent', intentId: intent, proof }],
  [{ ...body, intentId: intent }, { mode: 'intent', intentId: 'bad', proof }],
  [body, { mode: 'legacy', receiptId: 'bad', issuedAt: '2026-09-26T00:00:00Z' }],
  [body, { mode: 'legacy', receiptId: receipt, issuedAt: 'bad' }],
])('inconsistent capability never falls back %#', async (input, claim) => {
  expect(await setupFacilityAtomically(db, user, input, claim as FacilitySetupClaim)).toEqual({ state: 'unverified' });
  expect(rpc).not.toHaveBeenCalled();
});
test('direct setup whitelists trimmed values and no privilege fields', async () => {
  await expect(setupFacilityAtomically(db, user, { ...body, facility_name: ' Synthetic ', address: '' }, { mode: 'none' }))
    .resolves.toEqual({ state: 'created', facilityId: facility, slug: 'synthetic' });
  expect(rpc).toHaveBeenCalledWith('setup_facility_from_registration', {
    p_user_id: user, p_claim_mode: 'none', p_receipt_id: null, p_intent_id: null,
    p_proof_hash: null, p_legacy_issued_at: null, p_license_warranted: true,
    p_profile: { facility_name: 'Synthetic', business_type: businessTypes[0], address: '' },
  });
});
test('legacy issue time is included for the lock-time expiry check', async () => {
  await setupFacilityAtomically(db, user, body, { mode: 'legacy', receiptId: receipt, issuedAt: '2026-09-26T00:00:00Z' });
  expect(rpc.mock.calls[0][1]).toMatchObject({ p_claim_mode: 'legacy', p_receipt_id: receipt,
    p_legacy_issued_at: '2026-09-26T00:00:00Z', p_proof_hash: null, p_intent_id: null });
});
test('v2 RPC receives only a capability digest, not its plaintext', async () => {
  await setupFacilityAtomically(db, user, { ...body, intentId: intent }, { mode: 'intent', intentId: intent, proof });
  expect(rpc.mock.calls[0][1]).toMatchObject({ p_claim_mode: 'intent', p_intent_id: intent,
    p_proof_hash: salonIntentProofHash(proof), p_receipt_id: null, p_legacy_issued_at: null });
  expect(JSON.stringify(rpc.mock.calls[0])).not.toContain(proof);
  expect(rpc.mock.calls[0][1].p_profile).not.toHaveProperty('intentId');
});
test.each(['created', 'replay', 'already_member'])('recognizes %s with exact reference', async outcome => {
  rpc.mockResolvedValue({ data: [{ outcome, facility_id: facility, facility_slug: 'synthetic' }], error: null });
  expect(await setupFacilityAtomically(db, user, body, { mode: 'none' })).toEqual({ state: outcome, facilityId: facility, slug: 'synthetic' });
});
test.each(['invalid', 'unverified', 'conflict'])('recognizes explicit %s without a reference', async outcome => {
  rpc.mockResolvedValue({ data: [{ outcome, facility_id: null, facility_slug: null }], error: null });
  expect(await setupFacilityAtomically(db, user, body, { mode: 'none' })).toEqual({ state: outcome });
});
test.each([
  { data: null, error: null }, { data: [], error: null }, { data: [{}, {}], error: null },
  { data: {}, error: null }, { data: [{ outcome: 'created', facility_id: facility, facility_slug: '' }], error: null },
  { data: [{ outcome: 'created', facility_id: 'bad', facility_slug: 'synthetic' }], error: null },
  { data: [{ outcome: 'conflict', facility_id: facility, facility_slug: null }], error: null },
  { data: [{ outcome: 'created', facility_id: facility, facility_slug: 'synthetic', secret: 'extra' }], error: null },
  { data: [{ outcome: 'created', facility_id: facility, facility_slug: 'synthetic' }], error: { message: 'PRIVATE' } },
])('ambiguous RPC result is never treated as confirmed success/failure %#', async response => {
  rpc.mockResolvedValue(response);
  expect(await setupFacilityAtomically(db, user, body, { mode: 'none' })).toEqual({ state: 'unknown' });
  expect(rpc).toHaveBeenCalledTimes(1);
});
test('lost RPC response is unknown and never auto-retries or rolls back manually', async () => {
  rpc.mockRejectedValue(new Error('PRIVATE provider text'));
  expect(await setupFacilityAtomically(db, user, body, { mode: 'none' })).toEqual({ state: 'unknown' });
  expect(rpc).toHaveBeenCalledTimes(1);
});
