/**
 * トップの日本地図（components/home/JapanRegionMap.tsx）の地方区分とラベル位置（2026年10月23日）。
 *
 * 🔴 地方の分け方は regionGroups（src/lib/constants.ts）が単一ソース。
 * 以前の地図は独自の 9 地方（北信越・東海を分ける）を持ち、隣の「業種 × エリアで探す」は
 * regionGroups の 6 地方だったため、同じ画面で地方の分け方が食い違っていた。さらにラベルが
 * 地図とずれ（四国が九州の上・関西が四国の上・九州・沖縄が海の上）、どこを指すのか分からなかった。
 *
 * ラベル位置は地図（@react-map/japan・size=340 で 340×401px）上の座標（px）。
 * 本番の描画で各都道府県の外接矩形を測り、陸地に重ならない海の上で、その地方の陸地のすぐ隣に置いた。
 * 地図の大きさを変えたら測り直すこと（src/lib/__tests__/japan-map-regions.test.ts が
 * ラベル同士の重なりと地図からのはみ出しを検査する）。
 */
import { regionGroups } from './constants';
import { getPrefectureSlug } from './seo-constants';

/** 地図の描画サイズ（@react-map/japan の size と、その時の高さ）。 */
export const JAPAN_MAP_SIZE = { width: 340, height: 401 } as const;

interface RegionPlacement {
  /** 地方のリンク先にする代表の都道府県（地方単位の検索が無いため、その地方で最も大きい都市圏）。 */
  hub: string;
  /** ラベルの左上（px）。 */
  left: number;
  top: number;
}

const PLACEMENT: Record<string, RegionPlacement> = {
  '北海道・東北': { hub: '北海道', left: 146, top: 92 },
  関東: { hub: '東京都', left: 270, top: 196 },
  中部: { hub: '愛知県', left: 160, top: 132 },
  近畿: { hub: '大阪府', left: 172, top: 246 },
  '中国・四国': { hub: '広島県', left: 50, top: 182 },
  '九州・沖縄': { hub: '福岡県', left: 2, top: 272 },
};

export interface MapRegion extends RegionPlacement {
  name: string;
  /** 地図の path id（例 'Tokyo'）。都道府県のスラッグ（seo-constants）の先頭を大文字にしたもの。 */
  mapCodes: string[];
}

/** 地図の path id（'tokyo' → 'Tokyo'）。 */
export function mapCodeForPrefecture(prefecture: string): string {
  const slug = getPrefectureSlug(prefecture);
  if (!slug) throw new Error(`都道府県のスラッグが無い: ${prefecture}`);
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

export const MAP_REGIONS: MapRegion[] = regionGroups.map((group) => {
  const placement = PLACEMENT[group.name];
  if (!placement) throw new Error(`地図のラベル位置が無い地方: ${group.name}`);
  return { name: group.name, ...placement, mapCodes: group.prefectures.map(mapCodeForPrefecture) };
});

/** 地方のリンク先（代表の都道府県で検索）。 */
export function regionSearchHref(region: Pick<MapRegion, 'hub'>): string {
  return `/search?area=${encodeURIComponent(region.hub)}`;
}
