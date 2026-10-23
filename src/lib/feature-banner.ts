/**
 * 特集のバナー画像の単一ソース（2026年10月23日）。
 *
 * トップの特集バナー（components/home/HomeBelowFold.tsx）は業種ごとの写真
 * （public/images/banner-*.webp）を出しているのに、同じ特集を並べた /feature の一覧は
 * banner_image_url が空だと新聞のアイコンを出していた（本番の 3 件とも空）。
 * 同じ特集なのに画面によって写真があったり無かったりしないよう、業種 → 写真の対応をここに集め、
 * 特集に画像が登録されていなければ特集の業種（filter_type）の写真を使う。
 */

/** 業種ごとの特集写真（トップの特集バナーと同じもの）。 */
export const BUSINESS_TYPE_BANNER_IMAGES: Readonly<Record<string, string>> = {
  ヘアサロン: '/images/banner-hair.webp',
  リラクサロン: '/images/banner-relax.webp',
  'ネイル・まつげサロン': '/images/banner-eyelash.webp',
};

/**
 * 特集に出す画像。登録された画像があればそれ、無ければ業種の写真、どちらも無ければ null
 * （呼び出し側は控えめな地色だけを出す）。
 */
export function featureBannerImage(feature: { banner_image_url: string | null; filter_type: string | null }): string | null {
  if (feature.banner_image_url) return feature.banner_image_url;
  const type = feature.filter_type;
  if (type && Object.hasOwn(BUSINESS_TYPE_BANNER_IMAGES, type)) return BUSINESS_TYPE_BANNER_IMAGES[type]!;
  return null;
}
