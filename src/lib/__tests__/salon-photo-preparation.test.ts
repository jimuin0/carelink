/** @jest-environment node */
import { prepareSalonPhoto } from '../salon-photo-preparation';
import { salonIntentProofHash } from '../salon-submission-proof';

const intentId = '64000000-0000-4000-8000-000000000001';
const photoId = '64000000-0000-4000-8000-000000000002';
const input = { intentId, selectionId: photoId, slot: 0, mimeType: 'image/png', byteSize: 10 };
const proof = 'ab'.repeat(32);
const path = `salon-intents/${intentId}/${photoId}.png`;
const row = { outcome: 'prepared', photo_id: photoId, object_path: path };
const absent = { name: 'StorageApiError', message: 'Object not found', status: 400, statusCode: '404' };
const metadata = { bucketId: 'carelink-uploads', name: path, size: 10, contentType: 'image/png' };
function fixture() {
  const rpc = jest.fn().mockResolvedValue({ data: [row], error: null });
  const info = jest.fn().mockResolvedValue({ data: null, error: absent });
  const createSignedUploadUrl = jest.fn().mockResolvedValue({ data: { path, token: 'synthetic-capability', signedUrl: 'not-returned' }, error: null });
  const from = jest.fn().mockReturnValue({ info, createSignedUploadUrl });
  const db = { rpc, storage: { from } } as unknown as Parameters<typeof prepareSalonPhoto>[0];
  return { db, rpc, info, createSignedUploadUrl, from };
}
test.each([{}, { ...input, path: 'other' }, { ...input, slot: 7 }, { ...input, byteSize: 0 }])('invalid request never reaches persistence %#', async value => {
  const f = fixture();
  expect(await prepareSalonPhoto(f.db, value, proof)).toEqual({ state: 'invalid' });
  expect(f.rpc).not.toHaveBeenCalled();
});
test.each([undefined, 'bad', 'ab'.repeat(31)])('invalid capability never reaches persistence %#', async value => {
  const f = fixture();
  expect(await prepareSalonPhoto(f.db, input, value)).toEqual({ state: 'unverified' });
  expect(f.rpc).not.toHaveBeenCalled();
});
test.each([400, 404])('proven absent object permits immutable signing, HTTP %s', async status => {
  const f = fixture();
  f.info.mockResolvedValue({ data: null, error: { ...absent, status } });
  expect(await prepareSalonPhoto(f.db, input, proof)).toEqual({ state: 'upload', photoId, path, token: 'synthetic-capability' });
  expect(f.rpc).toHaveBeenCalledWith('prepare_salon_photo', {
    p_intent_id: intentId, p_proof_hash: salonIntentProofHash(proof), p_selection_id: photoId,
    p_slot: 0, p_mime_type: 'image/png', p_byte_size: 10,
  });
  expect(f.from).toHaveBeenCalledWith('carelink-uploads');
  expect(f.info).toHaveBeenCalledWith(path);
  expect(f.createSignedUploadUrl).toHaveBeenCalledWith(path, { upsert: false });
});
test.each(['unverified', 'expired', 'committed', 'invalid', 'conflict', 'limit'])('RPC %s prevents Storage access', async outcome => {
  const f = fixture();
  f.rpc.mockResolvedValue({ data: [{ outcome, photo_id: null, object_path: null }], error: null });
  expect(await prepareSalonPhoto(f.db, input, proof)).toEqual({ state: outcome });
  expect(f.from).not.toHaveBeenCalled();
});
test.each([
  { data: [row], error: {} }, { data: [row] }, { data: null, error: null },
  { data: [], error: null }, { data: [row, row], error: null },
  { data: [{ ...row, object_path: 'other/foreign.png' }], error: null },
  { data: [{ ...row, photo_id: 'bad' }], error: null },
  { data: [{ ...row, outcome: 'committed' }], error: null },
  { data: [{ ...row, outcome: 'unknown' }], error: null },
])('malformed/failed RPC never grants capability %#', async result => {
  const f = fixture(); f.rpc.mockResolvedValue(result);
  expect(await prepareSalonPhoto(f.db, input, proof)).toEqual({ state: 'unavailable' });
  expect(f.from).not.toHaveBeenCalled();
});
test('same selection reconciles an existing object without another token or upload', async () => {
  const f = fixture(); f.info.mockResolvedValue({ data: metadata, error: null });
  expect(await prepareSalonPhoto(f.db, input, proof)).toEqual({ state: 'uploaded', photoId, path });
  expect(f.createSignedUploadUrl).not.toHaveBeenCalled();
});
test.each([null, {}, { ...metadata, name: 'other' }, { ...metadata, bucketId: 'avatars' },
  { ...metadata, size: 11 }, { ...metadata, contentType: 'image/jpeg' }])('mismatched existing object is never overwritten %#', async data => {
  const f = fixture(); f.info.mockResolvedValue({ data, error: null });
  expect(await prepareSalonPhoto(f.db, input, proof)).toEqual({ state: 'conflict' });
  expect(f.createSignedUploadUrl).not.toHaveBeenCalled();
});
test.each([
  { data: metadata, error: absent }, { data: null, error: undefined },
  { data: null, error: { ...absent, name: 'StorageUnknownError' } },
  { data: null, error: { ...absent, status: 503 } },
  { data: null, error: { ...absent, message: 'Bucket not found' } },
  { data: null, error: { ...absent, statusCode: 'NoSuchBucket' } },
  { data: null, error: { status: 404 } },
])('unknown or infrastructure response cannot mean object absent %#', async result => {
  const f = fixture(); f.info.mockResolvedValue(result);
  expect(await prepareSalonPhoto(f.db, input, proof)).toEqual({ state: 'unavailable' });
  expect(f.createSignedUploadUrl).not.toHaveBeenCalled();
});
test.each([
  { data: { path, token: 'token' }, error: {} }, { data: { path, token: 'token' } },
  { data: null, error: null }, { data: { path: 'foreign', token: 'token' }, error: null },
  { data: { path, token: '' }, error: null }, { data: { path, token: 'x'.repeat(8193) }, error: null },
])('invalid signing result never escapes to the browser %#', async result => {
  const f = fixture(); f.createSignedUploadUrl.mockResolvedValue(result);
  expect(await prepareSalonPhoto(f.db, input, proof)).toEqual({ state: 'unavailable' });
});
test.each(['rpc', 'info', 'createSignedUploadUrl'] as const)('exception in %s returns a fixed retryable result', async stage => {
  const f = fixture(); f[stage].mockRejectedValue(new Error('private provider payload'));
  expect(await prepareSalonPhoto(f.db, input, proof)).toEqual({ state: 'unavailable' });
});
