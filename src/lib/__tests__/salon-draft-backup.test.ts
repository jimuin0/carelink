/** @jest-environment node */
import { createHash, webcrypto } from 'node:crypto';
import { exportSalonDraftBackup, importSalonDraftBackup, SALON_DRAFT_BACKUP_ERROR,
  SALON_DRAFT_MAX_BYTES, SALON_DRAFT_MAX_PHOTO_BYTES } from '../salon-draft-backup';

const originalCrypto = global.crypto;
beforeAll(() => { Object.defineProperty(global, 'crypto', { configurable: true, value: webcrypto }); });
afterAll(() => { Object.defineProperty(global, 'crypto', { configurable: true, value: originalCrypto }); });
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const photo = (name = '原画像.png', bytes: Uint8Array = new Uint8Array([0, 1, 254, 255]), type = 'image/png') =>
  new File([Uint8Array.from(bytes).buffer], name, { type, lastModified: 123456789 });
type Envelope = { format: string; version: number; sha256: string;
  payload: { values: Record<string, unknown>; photos: (null | {
    name: string; type: string; size: number; lastModified: number; base64: string; sha256: string;
  })[] } };
async function saved(): Promise<Envelope> {
  return JSON.parse(await (await exportSalonDraftBackup({ facility_name: '途中', email: '入力途中@' }, [photo()])).text());
}
function backup(envelope: Envelope, rehash = false) {
  if (rehash) envelope.sha256 = hash(JSON.stringify(envelope.payload));
  return new Blob([JSON.stringify(envelope)], { type: 'application/json' });
}

test('partial input and original image bytes/metadata/empty slots survive a manual round trip', async () => {
  const bytes = new Uint8Array(9000).map((_, index) => index % 256);
  const first = photo('内観.png', bytes);
  const last = photo('メニュー.gif', new Uint8Array([99, 0, 71]), 'image/gif');
  const values = { facility_name: ' 入力中 ', business_type: '', email: '途中@', phone: '',
    website: 'https://途中', seat_count: NaN, staff_count: 0, has_parking: false,
    prefecture: null, features: ['途中'], desired_start_date: '' };
  const blob = await exportSalonDraftBackup(values, [first, null, null, null, null, null, last]);
  expect(blob.type).toBe('application/json');
  const envelope = JSON.parse(await blob.text()) as Envelope;
  expect(envelope.sha256).toBe(hash(JSON.stringify(envelope.payload)));
  expect(envelope.payload.photos[0]?.sha256).toBe(hash(Buffer.from(bytes)));
  expect(Object.keys(envelope)).toEqual(['format', 'version', 'payload', 'sha256']);
  const restored = await importSalonDraftBackup(blob);
  expect(restored.values).toEqual({ ...values, seat_count: null });
  expect(restored.photos).toHaveLength(7);
  expect(restored.photos.slice(1, 6)).toEqual([null, null, null, null, null]);
  for (const [slot, original] of [[0, first], [6, last]] as const) {
    const result = restored.photos[slot]!;
    expect({ name: result.name, type: result.type, size: result.size, lastModified: result.lastModified })
      .toEqual({ name: original.name, type: original.type, size: original.size, lastModified: original.lastModified });
    expect(Buffer.from(await result.arrayBuffer())).toEqual(Buffer.from(await original.arrayBuffer()));
  }
});
test('an empty input draft needs no valid registration, capability, date or lifetime', async () => {
  const blob = await exportSalonDraftBackup({}, []);
  expect(await importSalonDraftBackup(blob)).toEqual({ values: {}, photos: Array(7).fill(null) });
  expect(await blob.text()).not.toMatch(/intent|proof|token|receipt|expires|created|agreed/);
});
test('number blanks become null while zero and limits survive', async () => {
  const blob = await exportSalonDraftBackup({ seat_count: 0, staff_count: 9999, phone: null, contact_phone: null }, [null]);
  expect((await importSalonDraftBackup(blob)).values).toEqual({ seat_count: 0, staff_count: 9999, phone: null, contact_phone: null });
});
test.each([
  { facility_name: 'x'.repeat(201) }, { address: 'x'.repeat(501) }, { email: 'x'.repeat(255) },
  { seat_count: -1 }, { staff_count: 10000 }, { seat_count: 1.5 }, { staff_count: Infinity },
  { phone: 123 }, { has_parking: 'true' }, { features: Array(21).fill('a') },
  { desired_start_date: 'unknown' }, { nested: {} }, { photo_urls: [] },
  { intentId: 'private' }, { proof: 'private' }, { receiptId: 'private' },
  { recaptcha_token: 'private' }, { agreed: true }, { source: 'register' },
])('unknown authority fields and structurally invalid input are never exported %#', async values => {
  await expect(exportSalonDraftBackup(values, [])).rejects.toThrow(SALON_DRAFT_BACKUP_ERROR);
});
test.each([
  ['empty', new File([], 'empty.png', { type: 'image/png' })],
  ['wrong MIME', photo('script.svg', new Uint8Array([1]), 'image/svg+xml')],
  ['path', photo('../photo.png')], ['control character', photo('photo\u0000.png')],
  ['large name', photo('x'.repeat(256))], ['fake File', {} as File],
])('invalid photo %s never produces a backup', async (_name, file) => {
  await expect(exportSalonDraftBackup({}, [file])).rejects.toThrow(SALON_DRAFT_BACKUP_ERROR);
});
test('more than seven slots is rejected even when all slots are empty', async () => {
  await expect(exportSalonDraftBackup({}, Array(8).fill(null))).rejects.toThrow(SALON_DRAFT_BACKUP_ERROR);
});
test('the exact 10MiB original image round-trips; one byte over is refused', async () => {
  const bytes = new Uint8Array(SALON_DRAFT_MAX_PHOTO_BYTES);
  bytes[bytes.length - 1] = 255;
  const blob = await exportSalonDraftBackup({}, [photo('boundary.png', bytes)]);
  const restored = await importSalonDraftBackup(blob);
  const restoredBytes = Buffer.from(await restored.photos[0]!.arrayBuffer());
  expect(restoredBytes.length).toBe(bytes.length);
  expect(hash(restoredBytes)).toBe(hash(Buffer.from(bytes)));
  await expect(exportSalonDraftBackup({}, [photo('large.png', new Uint8Array(bytes.length + 1))])).rejects.toThrow(SALON_DRAFT_BACKUP_ERROR);
}, 30000);
test('mismatched or failed reads are refused, never represented as an empty saved image', async () => {
  const mismatched = photo();
  Object.defineProperty(mismatched, 'arrayBuffer', { value: async () => new ArrayBuffer(0) });
  await expect(exportSalonDraftBackup({}, [mismatched])).rejects.toThrow(SALON_DRAFT_BACKUP_ERROR);
  const failed = photo();
  Object.defineProperty(failed, 'arrayBuffer', { value: async () => { throw new Error('private details'); } });
  await expect(exportSalonDraftBackup({}, [failed])).rejects.toThrow(SALON_DRAFT_BACKUP_ERROR);
});
test('crypto failure returns only the fixed safe error', async () => {
  const failing = jest.spyOn(webcrypto.subtle, 'digest').mockRejectedValueOnce(new Error('private details'));
  await expect(exportSalonDraftBackup({}, [])).rejects.toThrow(SALON_DRAFT_BACKUP_ERROR);
  failing.mockRestore();
});
test.each([new Blob([]), new Blob(['not JSON']), {} as Blob])('invalid files reject before returning any restored input %#', async file => {
  await expect(importSalonDraftBackup(file)).rejects.toThrow(SALON_DRAFT_BACKUP_ERROR);
});
test('oversized input refuses before reading or parsing', async () => {
  const file = new Blob(['small']);
  Object.defineProperty(file, 'size', { value: SALON_DRAFT_MAX_BYTES + 1 });
  const read = jest.spyOn(file, 'text');
  await expect(importSalonDraftBackup(file)).rejects.toThrow(SALON_DRAFT_BACKUP_ERROR);
  expect(read).not.toHaveBeenCalled();
});
test('read failure has a fixed safe error and no partial result', async () => {
  const file = new Blob(['small']);
  jest.spyOn(file, 'text').mockRejectedValue(new Error('private details'));
  await expect(importSalonDraftBackup(file)).rejects.toThrow(SALON_DRAFT_BACKUP_ERROR);
});
test.each(['version', 'format', 'values', 'slots', 'extra', 'authority', 'metadata'])('invalid envelope %s is refused even with a recomputed checksum', async mutation => {
  const envelope = await saved();
  if (mutation === 'version') envelope.version = 2;
  if (mutation === 'format') envelope.format = 'other';
  if (mutation === 'values') envelope.payload.values = { facility_name: 123 };
  if (mutation === 'slots') envelope.payload.photos.push(null);
  if (mutation === 'extra') Object.assign(envelope, { receiptId: 'fabricated' });
  if (mutation === 'authority') envelope.payload.values.intentId = 'fabricated';
  if (mutation === 'metadata') envelope.payload.photos[0]!.lastModified = -1;
  await expect(importSalonDraftBackup(backup(envelope, true))).rejects.toThrow(SALON_DRAFT_BACKUP_ERROR);
});
test.each(['value', 'name', 'slot', 'digest'])('untouched envelope checksum detects %s corruption', async mutation => {
  const envelope = await saved();
  if (mutation === 'value') envelope.payload.values.facility_name = 'changed';
  if (mutation === 'name') envelope.payload.photos[0]!.name = 'changed.png';
  if (mutation === 'slot') [envelope.payload.photos[0], envelope.payload.photos[1]] = [null, envelope.payload.photos[0]];
  if (mutation === 'digest') envelope.sha256 = '0'.repeat(64);
  await expect(importSalonDraftBackup(backup(envelope))).rejects.toThrow(SALON_DRAFT_BACKUP_ERROR);
});
test.each(['length', 'decoded-size', 'pad-bits', 'invalid', 'photo-hash'])('invalid photo %s rejects even when the envelope checksum matches', async mutation => {
  const envelope = await saved();
  const entry = envelope.payload.photos[0]!;
  if (mutation === 'length') entry.base64 = 'AA==';
  if (mutation === 'decoded-size') entry.base64 = 'AAAAAAAA';
  if (mutation === 'pad-bits') { entry.size = 1; entry.base64 = 'AB=='; }
  if (mutation === 'invalid') entry.base64 = '!invalid';
  if (mutation === 'photo-hash') entry.sha256 = '0'.repeat(64);
  await expect(importSalonDraftBackup(backup(envelope, true))).rejects.toThrow(SALON_DRAFT_BACKUP_ERROR);
});
test('all seven original images remain in slot order with the allowed image MIME types', async () => {
  const types = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const originals = Array.from({ length: 7 }, (_, slot) => photo(`${slot}.image`, new Uint8Array([slot]), types[slot % 4]));
  const restored = await importSalonDraftBackup(await exportSalonDraftBackup({}, originals));
  expect(restored.photos.map(file => file!.name)).toEqual(originals.map(file => file.name));
  expect(restored.photos.map(file => file!.type)).toEqual(originals.map(file => file.type));
});
