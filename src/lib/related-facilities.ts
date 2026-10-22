import { cache } from 'react';
import { getNearbyFacilities, getSimilarFacilities } from './facilities';
import type { FacilityCardData } from '@/types';

/** 施設ページ下部の「似たサロン」「〇〇市の他のサロン」それぞれに並べる最大件数。 */
export const RELATED_FACILITIES_LIMIT = 4;

/**
 * 「似たサロン・クリニック」（同業種・同じ都道府県）。
 * 「〇〇市の他のサロン」も重複を除くためにこの結果を使うので、同じリクエスト内では 1 回だけ読む。
 */
export const getSimilarForFacilityPage = cache(
  (facilityId: string, businessType: string, prefecture: string): Promise<FacilityCardData[]> =>
    getSimilarFacilities(facilityId, businessType, prefecture, RELATED_FACILITIES_LIMIT),
);

/**
 * 「〇〇市の他のサロン」。「似たサロン」に既に出した施設は除く（2026年10月23日）。
 * 同じ市の同業種の店は両方の条件に当たるため、以前は同じ店が 2 つの欄に続けて並んでいた。
 * 除いた分で欄が痩せないよう、多めに読んでから除外して上限件数に切り詰める
 * （「似たサロン」は最大 RELATED_FACILITIES_LIMIT 件なので、2 倍読めば必ず足りる）。
 */
export async function getNearbyForFacilityPage(
  facilityId: string,
  businessType: string,
  prefecture: string,
  city: string,
): Promise<FacilityCardData[]> {
  const [similar, nearby] = await Promise.all([
    getSimilarForFacilityPage(facilityId, businessType, prefecture),
    getNearbyFacilities(facilityId, prefecture, city, RELATED_FACILITIES_LIMIT * 2),
  ]);
  const shown = new Set(similar.map((f) => f.id));
  return nearby.filter((f) => !shown.has(f.id)).slice(0, RELATED_FACILITIES_LIMIT);
}
