/**
 * 共有画像（og:image / twitter:image）の単一ソース（2026年10月23日）。
 *
 * - 既定の画像 public/og-image.png は /api/og の既定（CareLink・ネットでかんたんサロン予約）と
 *   同じ絵。以前は旧サービス名の「医療・福祉・美容の採用×集客プラットフォーム」のままで、
 *   トップや検索の共有にその古い画像が出ていた。src/__tests__/default-og-image.test.ts が、
 *   ファイルが /api/og の既定の描画と一致していることを検査する（文言を変えたら再生成する）。
 * - トップは layout の openGraph を自分の openGraph で上書きしていたため og:image が無く、
 *   共有すると画像が出なかった。ページ側でも既定の画像を明示する。
 * - 施設ページはメイン写真があればそれ、無ければ店名入りの画像（/api/og）を出す。
 */

export const DEFAULT_SHARE_IMAGE = {
  url: '/og-image.png',
  width: 1200,
  height: 630,
  alt: 'CareLink | ネットでかんたんサロン予約',
} as const;

export interface ShareImage {
  url: string;
  width?: number;
  height?: number;
  alt: string;
}

/**
 * 施設ページの共有画像。メイン写真があれば写真（大きさは写真次第なので指定しない）、
 * 無ければ店名・業種・地域・評価を描いた 1200×630 の画像。
 */
export function facilityShareImage(
  siteUrl: string,
  facility: { name: string; main_photo_url: string | null; rating_avg: number | null; rating_count: number | null },
  subtitle: string,
): ShareImage {
  if (facility.main_photo_url) return { url: facility.main_photo_url, alt: facility.name };
  const params = new URLSearchParams({ title: facility.name, subtitle });
  if (facility.rating_avg) params.set('rating', facility.rating_avg.toFixed(1));
  if (facility.rating_count) params.set('reviews', String(facility.rating_count));
  return { url: `${siteUrl}/api/og?${params.toString()}`, width: 1200, height: 630, alt: facility.name };
}
