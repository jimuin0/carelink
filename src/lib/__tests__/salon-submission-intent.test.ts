/** @jest-environment node */
import { prepareSalonIntent, readSalonIntentStatus } from '../salon-submission-intent';
import { salonIntentProofHash, SALON_INTENT_TTL_SECONDS, SALON_PREPARE_TTL_SECONDS } from '../salon-submission-proof';

const intent = '63000000-0000-4000-8000-000000000001';
const receipt = '63000000-0000-4000-8000-000000000002';
const proof = '01'.repeat(32); // Synthetic capability; never a production credential.
const now = Date.parse('2026-09-26T00:00:00.000Z');
const pending = { salon_id: null, committed_at: null, canonical_version: 1, created_at: new Date(now - 1000).toISOString(),
  hmac_scheme: 'proof-hkdf-sha256-v1', prepare_expires_at: new Date(now + 1000).toISOString() };

function fixture(result: unknown) {
  const single = jest.fn().mockResolvedValue(result);
  const chain = { eq: jest.fn(), select: jest.fn(), single, maybeSingle: single, insert: jest.fn() };
  chain.eq.mockReturnValue(chain); chain.select.mockReturnValue(chain); chain.insert.mockReturnValue(chain);
  const from = jest.fn().mockReturnValue(chain);
  return { db: { from } as unknown as Parameters<typeof prepareSalonIntent>[0], chain, from, single };
}

test('preparation stores only the random proof digest and returns no applicant state', async () => {
  const { db, chain, single } = fixture(null);
  single.mockImplementation(async () => ({ data: { id: chain.insert.mock.calls.at(-1)[0].id }, error: null }));
  const first = await prepareSalonIntent(db);
  const second = await prepareSalonIntent(db);
  expect(first.state).toBe('prepared'); expect(second.state).toBe('prepared');
  if (first.state !== 'prepared' || second.state !== 'prepared') throw new Error('fixture preparation failed');
  expect(first.intentId).not.toBe(second.intentId); expect(first.proof).not.toBe(second.proof);
  expect(first.proof).toMatch(/^[a-f0-9]{64}$/);
  const saved = chain.insert.mock.calls[0][0];
  expect(saved).toEqual({ id: first.intentId, proof_hash: salonIntentProofHash(first.proof),
    canonical_version: 1, hmac_scheme: 'proof-hkdf-sha256-v1',
    created_at: expect.any(String), prepare_expires_at: first.expiresAt });
  expect(Date.parse(saved.prepare_expires_at) - Date.parse(saved.created_at)).toBe(SALON_PREPARE_TTL_SECONDS * 1000);
  expect(JSON.stringify(saved)).not.toContain(first.proof);
});

test.each([{ data: null, error: null }, { data: { id: 'wrong' }, error: null }, { data: null, error: { message: 'fixture DB error' } }])(
  'unconfirmed preparation exposes neither ID nor proof %#', async result => {
    expect(await prepareSalonIntent(fixture(result).db)).toEqual({ state: 'unavailable' });
  });

test('prepare transport loss never returns a capability', async () => {
  const { db, single } = fixture(null); single.mockRejectedValue(new Error('fixture response loss'));
  expect(await prepareSalonIntent(db)).toEqual({ state: 'unavailable' });
});

test.each([['not-id', proof], [intent, null], [intent, 'bad'], [intent, 123]])('invalid capability is rejected before DB %#', async (id, candidate) => {
  const { db, from } = fixture(null);
  expect(await readSalonIntentStatus(db, id as string, candidate, now)).toEqual({ state: 'unverified' });
  expect(from).not.toHaveBeenCalled();
});

test('status binds both identifier and proof and projects only state metadata', async () => {
  const { db, chain, from } = fixture({ data: pending, error: null });
  expect(await readSalonIntentStatus(db, intent, proof, now)).toEqual({ state: 'uncommitted' });
  expect(from).toHaveBeenCalledWith('salon_submission_intents');
  expect(chain.select).toHaveBeenCalledWith('salon_id,committed_at,created_at,prepare_expires_at,canonical_version,hmac_scheme');
  expect(chain.eq.mock.calls).toEqual([['id', intent], ['proof_hash', salonIntentProofHash(proof)]]);
});

test('status defaults to the current clock when no reconciliation clock is supplied', async () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  try {
    expect(await readSalonIntentStatus(fixture({ data: pending, error: null }).db, intent, proof))
      .toEqual({ state: 'uncommitted' });
  } finally { clock.mockRestore(); }
});

test.each([{}, { salon_id: receipt, committed_at: '2026-09-25T00:00:00.000Z' }])('expiry distinguishes committed from uncommitted %#', async committed => {
  const db = fixture({ data: { ...pending, ...committed, prepare_expires_at: new Date(now).toISOString() }, error: null }).db;
  expect(await readSalonIntentStatus(db, intent, proof, now)).toEqual('salon_id' in committed
    ? { state: 'committed', receiptId: receipt } : { state: 'expired' });
});

test.each([
  { created_at: 'bad-date' },
  { canonical_version: 2 }, { hmac_scheme: 'unsupported' }, { prepare_expires_at: 'bad-date' },
  { salon_id: receipt }, { committed_at: '2026-09-25T00:00:00.000Z' },
  { salon_id: 'bad-id', committed_at: '2026-09-25T00:00:00.000Z' },
  { salon_id: 123, committed_at: '2026-09-25T00:00:00.000Z' },
  { salon_id: receipt, committed_at: 'bad-date' },
])('inconsistent DB state is never a confirmed receipt %#', async patch => {
  expect(await readSalonIntentStatus(fixture({ data: { ...pending, ...patch }, error: null }).db, intent, proof, now))
    .toEqual({ state: 'unavailable' });
});

test.each([now + 1, now - SALON_INTENT_TTL_SECONDS * 1000, now - SALON_INTENT_TTL_SECONDS * 1000 - 1])(
  'copied capability is rejected outside its server lifetime even for a committed receipt %#', async issuedAt => {
    const data = { ...pending, salon_id: receipt, committed_at: pending.created_at, created_at: new Date(issuedAt).toISOString() };
    expect(await readSalonIntentStatus(fixture({ data, error: null }).db, intent, proof, now))
      .toEqual({ state: 'unverified' });
  });

test('missing and wrong-proof rows have no existence disclosure', async () => {
  expect(await readSalonIntentStatus(fixture({ data: null, error: null }).db, intent, proof, now))
    .toEqual({ state: 'unverified' });
});

test('DB error is not interpreted as absent', async () => {
  expect(await readSalonIntentStatus(fixture({ data: null, error: { message: 'fixture error' } }).db, intent, proof, now))
    .toEqual({ state: 'unavailable' });
});

test('status transport failure is not interpreted as absent', async () => {
  const { db, single } = fixture(null); single.mockRejectedValue(new Error('fixture response loss'));
  expect(await readSalonIntentStatus(db, intent, proof, now)).toEqual({ state: 'unavailable' });
});
