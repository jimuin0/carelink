/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 写真の一括アップロードで、1 枚でも大きすぎると全部を断り、どの写真かも言わなかった（2026年10月23日）。
 */
import { ADMIN_PHOTO_MAX_BYTES, describePhotoRejections, preparePhotoBatch } from '../admin-photo-batch';

function sized(name: string, type: string, bytes: number) {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}
const big = ADMIN_PHOTO_MAX_BYTES + 1;

test('5MB 以下の対応形式はそのまま、選んだ順に上げる（縮小しない）', async () => {
  const shrink = jest.fn();
  const files = [sized('a.jpg', 'image/jpeg', 10), sized('b.png', 'image/png', ADMIN_PHOTO_MAX_BYTES), sized('c.webp', 'image/webp', 10)];
  const batch = await preparePhotoBatch(files, shrink);
  expect(batch.accepted).toEqual(files);
  expect(batch.rejected).toEqual([]);
  expect(shrink).not.toHaveBeenCalled();
});

test('形式の違う写真は縮小を試さずに断る', async () => {
  const shrink = jest.fn();
  const batch = await preparePhotoBatch([sized('scan.heic', 'image/heic', big), sized('doc.pdf', 'application/pdf', 10)], shrink);
  expect(batch).toEqual({ accepted: [], rejected: [{ name: 'scan.heic', reason: 'type' }, { name: 'doc.pdf', reason: 'type' }] });
  expect(shrink).not.toHaveBeenCalled();
});

test('大きすぎる写真は縮小を試し、収まれば縮小後を上げる', async () => {
  const smaller = sized('big.jpg', 'image/jpeg', 1000);
  const batch = await preparePhotoBatch([sized('big.png', 'image/png', big)], async () => smaller);
  expect(batch).toEqual({ accepted: [smaller], rejected: [] });
});

test.each([
  ['縮小しても大きい', async (file: File) => file],
  ['縮小で対応外の形式になった', async () => sized('x.gif', 'image/gif', 10)],
  ['縮小に失敗した', async () => { throw new Error('decode'); }],
])('%s写真は、ほかの写真を止めずに断る', async (_label, shrink) => {
  const ok = sized('ok.jpg', 'image/jpeg', 10);
  const batch = await preparePhotoBatch([sized('huge.jpg', 'image/jpeg', big), ok], shrink);
  expect(batch).toEqual({ accepted: [ok], rejected: [{ name: 'huge.jpg', reason: 'size' }] });
});

test('断った写真はファイル名と理由で 1 行ずつ', () => {
  expect(describePhotoRejections([{ name: 'a.heic', reason: 'type' }, { name: 'b.jpg', reason: 'size' }])).toEqual([
    'a.heic（JPG・PNG・WebP以外の形式）',
    'b.jpg（5MBを超え、縮小しても収まりませんでした）',
  ]);
  expect(describePhotoRejections([])).toEqual([]);
});
