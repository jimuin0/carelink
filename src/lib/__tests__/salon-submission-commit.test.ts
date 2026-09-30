/** @jest-environment node */
jest.mock('../salon-submission-intent', () => ({ readSalonIntentStatus: jest.fn() }));
import { commitSalonSubmission } from '../salon-submission-commit';
import { readSalonIntentStatus } from '../salon-submission-intent';
import { businessTypes } from '../constants';
import { salonPayloadHmac, salonIntentProofHash } from '../salon-submission-proof';
import { canonicalSalonSubmission } from '../salon-submission-contract';

const intentId = '64000000-0000-4000-8000-000000000001';
const photoId = '64000000-0000-4000-8000-000000000002';
const receiptId = '64000000-0000-4000-8000-000000000003';
const secondId = '64000000-0000-4000-8000-000000000004';
const proof = 'ab'.repeat(32);
const registration = { facility_name: 'Synthetic', representative_name: 'Synthetic', contact_name: 'Synthetic',
  business_type: businessTypes[0], email: 'synthetic@example.invalid', phone: '09012345678', source: 'register' };
const input = { intentId, registration, photoIds: [photoId] };
const path = `salon-intents/${intentId}/${photoId}.png`;
const url = `https://storage.example.invalid/storage/v1/object/public/carelink-uploads/${path}`;
const photo = { id: photoId, intent_id: intentId, slot: 0, mime_type: 'image/png', byte_size: 10, object_path: path };
const info = { bucketId: 'carelink-uploads', name: path, size: 10, contentType: 'image/png' };
function fixture() {
  const query = { select: jest.fn(), eq: jest.fn(), in: jest.fn().mockResolvedValue({ data: [photo], error: null }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  const storage = { info: jest.fn().mockResolvedValue({ data: info, error: null }),
    getPublicUrl: jest.fn().mockReturnValue({ data: { publicUrl: url } }) };
  const rpc = jest.fn().mockResolvedValue({ data: [{ outcome: 'committed', receipt_id: receiptId }], error: null });
  const db = { from: jest.fn().mockReturnValue(query), storage: { from: jest.fn().mockReturnValue(storage) }, rpc };
  return { db: db as unknown as Parameters<typeof commitSalonSubmission>[0], from: db.from, query, storage, rpc };
}
beforeEach(() => { jest.clearAllMocks(); (readSalonIntentStatus as jest.Mock).mockResolvedValue({ state: 'uncommitted' }); });
test.each([{}, { ...input, photoIds: [photoId, photoId] }, { ...input, photoIds: Array(8).fill(photoId) },
  { ...input, registration: { ...registration, photo_urls: [url] } }, { ...input, registration: { ...registration, status: 'approved' } },
  { ...input, registration: { ...registration, source: 'other' } }])('rejects malformed/overposting input without I/O %#', async value => {
  const f = fixture(); expect(await commitSalonSubmission(f.db, value, proof)).toEqual({ state: 'invalid' });
  expect(readSalonIntentStatus).not.toHaveBeenCalled(); expect(f.from).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
});
test('invalid proof performs no I/O', async () => {
  const f = fixture(); expect(await commitSalonSubmission(f.db, input, 'bad')).toEqual({ state: 'unverified' });
  expect(readSalonIntentStatus).not.toHaveBeenCalled();
});
test.each(['unverified', 'expired', 'unavailable'])('status %s prevents manifest reads and writes', async state => {
  const f = fixture(); (readSalonIntentStatus as jest.Mock).mockResolvedValue({ state });
  expect(await commitSalonSubmission(f.db, input, proof)).toEqual({ state }); expect(f.from).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
});
test('selected objects are scoped, verified and hashed before atomic commit', async () => {
  const f = fixture(); expect(await commitSalonSubmission(f.db, input, proof)).toEqual({ state: 'committed', receiptId });
  expect(readSalonIntentStatus).toHaveBeenCalledWith(f.db, intentId, proof);
  expect(f.from).toHaveBeenCalledWith('salon_submission_photos');
  expect(f.query.eq).toHaveBeenCalledWith('intent_id', intentId); expect(f.query.in).toHaveBeenCalledWith('id', [photoId]);
  expect(f.storage.info).toHaveBeenCalledWith(path);
  const canonical = canonicalSalonSubmission({ ...registration, photo_urls: [url] })!;
  expect(f.rpc).toHaveBeenCalledWith('commit_salon_submission', { p_intent_id: intentId, p_proof_hash: salonIntentProofHash(proof),
    p_canonical_version: 1, p_hmac_scheme: 'proof-hkdf-sha256-v1', p_payload_hmac: salonPayloadHmac(proof, canonical.serialized), p_registration: canonical.row });
});
test('no-photo submission verifies proof but does not touch Storage or manifest', async () => {
  const f = fixture(); expect(await commitSalonSubmission(f.db, { ...input, photoIds: [] }, proof)).toEqual({ state: 'committed', receiptId });
  expect(readSalonIntentStatus).toHaveBeenCalled(); expect(f.from).not.toHaveBeenCalled(); expect(f.storage.info).not.toHaveBeenCalled();
  expect(f.rpc.mock.calls[0][1].p_registration.photo_urls).toEqual([]);
});
test('manifest row order and request ID order cannot reorder the declared slots', async () => {
  const f = fixture(); const other = { ...photo, id: secondId, slot: 6, object_path: path.replace(photoId, secondId) };
  f.query.in.mockResolvedValue({ data: [other, photo], error: null });
  f.storage.info.mockImplementation(async name => ({ data: { ...info, name }, error: null }));
  f.storage.getPublicUrl.mockImplementation(name => ({ data: { publicUrl: url.replace(path, name) } }));
  expect(await commitSalonSubmission(f.db, { ...input, photoIds: [secondId, photoId] }, proof)).toEqual({ state: 'committed', receiptId });
  expect(f.rpc.mock.calls[0][1].p_registration.photo_urls).toEqual([url, url.replace(photoId, secondId)]);
});
test.each([
  { data: [], error: null }, { data: [{ ...photo, intent_id: secondId }], error: null },
  { data: [{ ...photo, id: secondId }], error: null }, { data: [{ ...photo, object_path: 'foreign/file.png' }], error: null },
])('absent/foreign manifest cannot be committed %#', async result => {
  const f = fixture(); f.query.in.mockResolvedValue(result);
  expect(await commitSalonSubmission(f.db, input, proof)).toEqual({ state: 'photo_unverified' }); expect(f.rpc).not.toHaveBeenCalled();
});
test.each([
  { data: [photo, photo] }, { data: [photo, { ...photo, id: secondId }] },
])('duplicate IDs or slots cannot be committed %#', async ({ data }) => {
  const f = fixture(); f.query.in.mockResolvedValue({ data, error: null });
  expect(await commitSalonSubmission(f.db, { ...input, photoIds: [photoId, secondId] }, proof)).toEqual({ state: 'photo_unverified' }); expect(f.rpc).not.toHaveBeenCalled();
});
test.each([{ data: null, error: null }, { data: [photo], error: {} }, { data: [photo] },
  { data: [{ ...photo, slot: 7 }], error: null }, { data: [{ ...photo, byte_size: '10' }], error: null }])('manifest error/malformed shape fails closed %#', async result => {
  const f = fixture(); f.query.in.mockResolvedValue(result);
  expect(await commitSalonSubmission(f.db, input, proof)).toEqual({ state: 'unavailable' }); expect(f.rpc).not.toHaveBeenCalled();
});
test.each([{ data: null, error: null },
  { data: { ...info, size: 11 }, error: null }, { data: { ...info, bucketId: 'avatars' }, error: null },
  { data: { ...info, contentType: 'image/jpeg' }, error: null }])('photo not proven uploaded blocks commit without deletion %#', async result => {
  const f = fixture(); f.storage.info.mockResolvedValue(result);
  expect(await commitSalonSubmission(f.db, input, proof)).toEqual({ state: 'photo_unverified' }); expect(f.rpc).not.toHaveBeenCalled();
});
test.each([{ data: info, error: {} }, { data: info }, { data: null, error: { status: 503 } },
  { data: null, error: { name: 'StorageApiError', message: 'Bucket not found', status: 404, statusCode: '404' } },
  { data: info, error: { name: 'StorageApiError', message: 'Object not found', status: 404, statusCode: '404' } }])('Storage infrastructure/unknown error is unavailable, not an invalid photo %#', async result => {
  const f = fixture(); f.storage.info.mockResolvedValue(result);
  expect(await commitSalonSubmission(f.db, input, proof)).toEqual({ state: 'unavailable' }); expect(f.rpc).not.toHaveBeenCalled();
});
test('only an explicit object absence is photo_unverified', async () => {
  const f = fixture(); f.storage.info.mockResolvedValue({ data: null, error: { name: 'StorageApiError', message: 'Object not found', status: 400, statusCode: '404' } });
  expect(await commitSalonSubmission(f.db, input, proof)).toEqual({ state: 'photo_unverified' }); expect(f.rpc).not.toHaveBeenCalled();
});
test.each(['not-url', `ftp://host${new URL(url).pathname}`, `${url}?x=1`, `${url}#hash`,
  url.replace('https://', 'https://user@'), url.replace('https://', 'https://user:pass@'), url.replace(path, 'other')])('unexpected public URL is not persisted %#', async publicUrl => {
  const f = fixture(); f.storage.getPublicUrl.mockReturnValue({ data: { publicUrl } });
  expect(await commitSalonSubmission(f.db, input, proof)).toEqual({ state: 'unavailable' }); expect(f.rpc).not.toHaveBeenCalled();
});
test('oversized provider URL fails canonical schema rather than creating an invalid record', async () => {
  const f = fixture(); f.storage.getPublicUrl.mockReturnValue({ data: { publicUrl: url.replace('storage.example.invalid', `${'a'.repeat(2000)}.invalid`) } });
  expect(await commitSalonSubmission(f.db, input, proof)).toEqual({ state: 'invalid' }); expect(f.rpc).not.toHaveBeenCalled();
});
test('confirmed receipt replay tolerates a Storage outage but still compares the exact payload', async () => {
  const f = fixture(); (readSalonIntentStatus as jest.Mock).mockResolvedValue({ state: 'committed', receiptId });
  f.storage.info.mockRejectedValue(new Error('outage')); f.rpc.mockResolvedValue({ data: [{ outcome: 'replay', receipt_id: receiptId }], error: null });
  expect(await commitSalonSubmission(f.db, input, proof)).toEqual({ state: 'replay', receiptId }); expect(f.storage.info).not.toHaveBeenCalled();
});
test.each(['unverified', 'expired', 'conflict'])('atomic rejection %s is preserved', async outcome => {
  const f = fixture(); f.rpc.mockResolvedValue({ data: [{ outcome, receipt_id: null }], error: null });
  expect(await commitSalonSubmission(f.db, input, proof)).toEqual({ state: outcome });
});
test.each([{ data: [], error: null }, { data: null, error: null }, { data: [{ outcome: 'committed', receipt_id: 'bad' }], error: null },
  { data: [{ outcome: 'conflict', receipt_id: receiptId }], error: null }, { data: [{ outcome: 'replay', receipt_id: receiptId }], error: {} },
  { data: [{ outcome: 'replay', receipt_id: receiptId }] }])('unproven RPC result is unknown, not failure/success %#', async result => {
  const f = fixture(); f.rpc.mockResolvedValue(result);
  expect(await commitSalonSubmission(f.db, input, proof)).toEqual({ state: 'unknown' });
});
test('receipt mismatch is unknown', async () => {
  const f = fixture(); (readSalonIntentStatus as jest.Mock).mockResolvedValue({ state: 'committed', receiptId: secondId });
  expect(await commitSalonSubmission(f.db, input, proof)).toEqual({ state: 'unknown' });
});
test.each(['status', 'manifest', 'storage', 'url', 'rpc'])('exception at %s is classified by whether commit was attempted', async stage => {
  const f = fixture(); const error = new Error('private data');
  if (stage === 'status') (readSalonIntentStatus as jest.Mock).mockRejectedValue(error);
  if (stage === 'manifest') f.query.in.mockRejectedValue(error);
  if (stage === 'storage') f.storage.info.mockRejectedValue(error);
  if (stage === 'url') f.storage.getPublicUrl.mockImplementation(() => { throw error; });
  if (stage === 'rpc') f.rpc.mockRejectedValue(error);
  expect(await commitSalonSubmission(f.db, input, proof)).toEqual({ state: stage === 'rpc' ? 'unknown' : 'unavailable' });
});
