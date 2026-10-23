/**
 * @jest-environment node
 *
 * 既定の共有画像 public/og-image.png（2026年10月23日）。
 *
 * 【不具合】layout.tsx の既定 og:image / twitter:image が指す public/og-image.png は、旧サービス名の
 * 「医療・福祉・美容の採用×集客プラットフォーム」を描いた古い画像のままだった。トップ・検索・特集などを
 * 共有すると、今のサービス（ネットでかんたんサロン予約）と違う画像が出ていた。
 *
 * 【固定】ファイルは /api/og の既定の描画（src/lib/og-image.ts・CareLink／ネットでかんたんサロン予約）
 * と同じ画像にする。ここでは同じ描画を行って、ファイルとバイト単位で一致することを確かめる。
 * og-image.ts の既定の文言・デザインを変えたら、次のコマンドでファイルを描き直してコミットする:
 *
 *   UPDATE_DEFAULT_OG_IMAGE=1 npx jest src/__tests__/default-og-image.test.ts
 *
 * あわせて、トップと施設ページがこの画像（施設はメイン写真か店名入りの画像）を明示していることを見る
 * （トップは layout の openGraph を上書きしていたため og:image が無かった）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderOgImagePng } from '@/lib/og-image';
import { DEFAULT_SHARE_IMAGE, facilityShareImage } from '@/lib/share-image';

const ROOT = process.cwd();
const FILE = join(ROOT, 'public', DEFAULT_SHARE_IMAGE.url);

function pngSize(buf: Buffer) {
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('public/og-image.png は /api/og の既定の描画と同じ（旧「採用×集客」の画像ではない）', async () => {
  const rendered = await renderOgImagePng(new URLSearchParams());
  if (process.env.UPDATE_DEFAULT_OG_IMAGE === '1') writeFileSync(FILE, rendered);
  const file = readFileSync(FILE);
  expect(pngSize(file)).toEqual({ width: DEFAULT_SHARE_IMAGE.width, height: DEFAULT_SHARE_IMAGE.height });
  expect(file.equals(rendered)).toBe(true);
}, 60_000);

test('layout の既定はこの画像を指している（layout 側の参照先が変わったらここも合わせる）', () => {
  const layout = readFileSync(join(ROOT, 'src/app/layout.tsx'), 'utf8');
  expect(layout).toContain(`"${DEFAULT_SHARE_IMAGE.url}"`);
});

test('トップは og と twitter の両方で既定の画像を明示する', async () => {
  jest.resetModules();
  jest.doMock('@/lib/facilities', () => ({ getAvailableAreasAndTypes: jest.fn() }));
  jest.doMock('@/components/home/DynamicHomeSections', () => ({ HomeBelowFold: () => null, StickySignupCta: () => null }));
  jest.doMock('@/components/home/ReferralInviteNotice', () => ({ __esModule: true, default: () => null }));
  jest.doMock('@/components/search/HomeSearchForm', () => ({ __esModule: true, default: () => null }));
  const { metadata } = await import('@/app/page');
  expect(metadata.openGraph?.images).toEqual([DEFAULT_SHARE_IMAGE]);
  expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', images: [{ url: DEFAULT_SHARE_IMAGE.url, alt: DEFAULT_SHARE_IMAGE.alt }] });
  expect((metadata.twitter as { title?: string }).title).toBe(metadata.openGraph?.title);
});

describe('施設ページの共有画像', () => {
  const facility = { name: 'ハル 豊中本店', main_photo_url: null, rating_avg: 4.56, rating_count: 12 };

  test('メイン写真があれば写真', () => {
    expect(facilityShareImage('https://carelink-jp.com', { ...facility, main_photo_url: 'https://x.supabase.co/storage/v1/object/public/p.webp' }, '業種 | 地域'))
      .toEqual({ url: 'https://x.supabase.co/storage/v1/object/public/p.webp', alt: 'ハル 豊中本店' });
  });

  test('写真が無ければ店名・業種・地域・評価を描いた 1200×630 の画像', () => {
    const image = facilityShareImage('https://carelink-jp.com', facility, 'ネイル・まつげサロン | 大阪府豊中市');
    expect(image).toMatchObject({ width: 1200, height: 630, alt: 'ハル 豊中本店' });
    const url = new URL(image.url);
    expect(url.origin + url.pathname).toBe('https://carelink-jp.com/api/og');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      title: 'ハル 豊中本店', subtitle: 'ネイル・まつげサロン | 大阪府豊中市', rating: '4.6', reviews: '12',
    });
  });

  test('評価が無ければ評価を描かない', () => {
    const url = new URL(facilityShareImage('https://carelink-jp.com', { ...facility, rating_avg: 0, rating_count: 0 }, 's').url);
    expect(url.searchParams.has('rating')).toBe(false);
    expect(url.searchParams.has('reviews')).toBe(false);
  });
});
