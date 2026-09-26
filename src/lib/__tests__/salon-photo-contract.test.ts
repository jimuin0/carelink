import { matchesSalonPhoto, salonPhotoInput, salonPhotoPath, SALON_PHOTO_BUCKET } from '../salon-photo-contract';

const intent = '64000000-0000-4000-8000-000000000001';
const photo = '64000000-0000-4000-8000-000000000002';
const valid = { intentId: intent, selectionId: photo, slot: 0, mimeType: 'image/png', byteSize: 1 };
const path = `salon-intents/${intent}/${photo}.png`;

test.each([
  { slot: -1 }, { slot: 7 }, { slot: 1.5 }, { slot: '0' },
  { byteSize: 0 }, { byteSize: 10485761 }, { byteSize: 1.5 }, { byteSize: '1' },
  { mimeType: 'image/svg+xml' }, { intentId: '../other' }, { selectionId: null },
  { path }, { token: 'synthetic' },
])('photo input refuses malformed or client-selected provider fields %#', value => {
  expect(salonPhotoInput.safeParse({ ...valid, ...value }).success).toBe(false);
});

test('photo input accepts both size/slot boundaries', () => {
  expect(salonPhotoInput.parse(valid)).toEqual(valid);
  expect(salonPhotoInput.parse({ ...valid, slot: 6, byteSize: 10485760 })).toEqual({ ...valid, slot: 6, byteSize: 10485760 });
});

test.each([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/gif', 'gif']])('server path is canonical for %s', (mimeType, extension) => {
  expect(salonPhotoPath(intent, photo, mimeType)).toBe(`salon-intents/${intent}/${photo}.${extension}`);
});
test('UUID casing does not change the database path', () => {
  const mixed = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  expect(salonPhotoPath(mixed.toUpperCase(), photo, 'image/png')).toBe(`salon-intents/${mixed}/${photo}.png`);
});
test.each([['../other', photo, 'image/png'], [intent, '../other', 'image/png'], [intent, photo, 'text/html']])('invalid provider path inputs fail closed %#', (a, b, c) => {
  expect(salonPhotoPath(a, b, c)).toBeNull();
});

const info = { bucketId: SALON_PHOTO_BUCKET, name: path, size: 1, contentType: 'image/png', id: photo };
test('stored metadata must match all selected facts', () => {
  expect(matchesSalonPhoto(info, path, valid)).toBe(true);
});
test.each([
  null, {}, { ...info, bucketId: 'avatars' }, { ...info, name: 'other/photo.png' },
  { ...info, size: '1' }, { ...info, size: 2 }, { ...info, size: 0 },
  { ...info, contentType: 'image/jpeg' }, { ...info, contentType: 'text/html' },
])('missing, different-scope or mismatched stored metadata is not success %#', metadata => {
  expect(matchesSalonPhoto(metadata, path, valid)).toBe(false);
});
