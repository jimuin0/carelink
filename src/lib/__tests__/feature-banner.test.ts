/**
 * 特集のバナー画像（src/lib/feature-banner.ts）。
 *
 * 【回帰防止・2026年10月23日】トップの特集バナーは業種の写真を出しているのに、/feature の一覧は
 * banner_image_url が空だと新聞のアイコンを出していた（本番の 3 件とも空）。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BUSINESS_TYPE_BANNER_IMAGES, featureBannerImage } from '@/lib/feature-banner';

test('登録された画像があればそれを使う', () => {
  expect(featureBannerImage({ banner_image_url: 'https://example.invalid/a.webp', filter_type: 'ヘアサロン' })).toBe('https://example.invalid/a.webp');
});

test.each([
  ['ヘアサロン', '/images/banner-hair.webp'],
  ['リラクサロン', '/images/banner-relax.webp'],
  ['ネイル・まつげサロン', '/images/banner-eyelash.webp'],
])('画像が無ければ業種（%s）の写真＝トップの特集バナーと同じもの', (type, image) => {
  expect(featureBannerImage({ banner_image_url: null, filter_type: type })).toBe(image);
  expect(featureBannerImage({ banner_image_url: '', filter_type: type })).toBe(image);
});

test.each([
  ['業種が無い', null],
  ['写真の無い業種', '鍼灸院・整骨院'],
  ['プロトタイプのキー', 'toString'],
])('%s特集は null（呼び出し側は地色だけを出す）', (_label, type) => {
  expect(featureBannerImage({ banner_image_url: null, filter_type: type })).toBeNull();
});

test('写真のファイルが public/ に実在する', () => {
  for (const image of Object.values(BUSINESS_TYPE_BANNER_IMAGES)) {
    expect([image, existsSync(join(process.cwd(), 'public', image))]).toEqual([image, true]);
  }
});
