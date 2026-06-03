/**
 * @jest-environment node
 *
 * Tests for lib/storage-cleanup.ts（画像削除時の孤児化防止 #06）
 */
import { storagePathFromPublicUrl, storagePathsFromUrls, UPLOAD_BUCKET } from '../storage-cleanup';

const PUB = (path: string) => `https://x.supabase.co/storage/v1/object/public/${UPLOAD_BUCKET}/${path}`;

describe('storagePathFromPublicUrl', () => {
  test('公開URLからパス抽出', () => { expect(storagePathFromPublicUrl(PUB('salons/abc/photo.jpg'))).toBe('salons/abc/photo.jpg'); });
  test('クエリ文字列を除去', () => { expect(storagePathFromPublicUrl(PUB('a/b.jpg') + '?token=xyz')).toBe('a/b.jpg'); });
  test('URLエンコードをデコード', () => { expect(storagePathFromPublicUrl(PUB('a/%E7%94%BB%E5%83%8F.jpg'))).toBe('a/画像.jpg'); });
  test('data URI は対象外(null)', () => { expect(storagePathFromPublicUrl('data:image/png;base64,AAAA')).toBeNull(); });
  test('外部URL(別バケット)は対象外(null)', () => { expect(storagePathFromPublicUrl('https://other.com/x.jpg')).toBeNull(); });
  test('null/空は null', () => { expect(storagePathFromPublicUrl(null)).toBeNull(); expect(storagePathFromPublicUrl('')).toBeNull(); });
  test('マーカー直後が空なら null', () => { expect(storagePathFromPublicUrl(PUB(''))).toBeNull(); });
});

describe('storagePathsFromUrls', () => {
  test('複数URLからパス配列（null/重複除去）', () => {
    expect(storagePathsFromUrls([PUB('a.jpg'), 'data:image/png;base64,X', PUB('a.jpg'), PUB('b.jpg'), null])).toEqual(['a.jpg', 'b.jpg']);
  });
  test('全て対象外なら空配列', () => { expect(storagePathsFromUrls(['data:image/png;base64,X', null, 'https://e.com/x.jpg'])).toEqual([]); });
});

test('不正な%エンコードは decode 失敗時そのまま返す(catch経路)', () => {
  expect(storagePathFromPublicUrl(PUB('bad%E0%A4'))).toBe('bad%E0%A4');
});
