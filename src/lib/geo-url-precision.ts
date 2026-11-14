/**
 * 「現在地から探す」で検索結果の URL に載せる座標の精度（単一ソース）。
 *
 * 端末の現在地は数メートル精度で取れるが、URL は履歴・共有・アクセスログに残る。
 * 検索（半径 km 単位の近い順）には約 1km の精度で足りるため、小数点以下 2 桁に丸めてから載せる
 * （緯度 0.01 度 ≒ 1.1km）。検索の仕組み自体は変えない。
 */
export const GEO_URL_DECIMALS = 2;

/** 座標を URL 用に丸める。数値でないもの（NaN・Infinity）は null。 */
export function roundCoordForUrl(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Number(value.toFixed(GEO_URL_DECIMALS));
  // -0 を "0" にそろえる（"-0" を URL に出さない）
  return String(rounded === 0 ? 0 : rounded);
}

/** 現在地検索の URL を組み立てる。座標が不正なら null。 */
export function geoSearchPath(latitude: number, longitude: number): string | null {
  const lat = roundCoordForUrl(latitude);
  const lng = roundCoordForUrl(longitude);
  if (lat === null || lng === null) return null;
  return `/search?lat=${lat}&lng=${lng}`;
}
