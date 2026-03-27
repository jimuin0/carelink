import Link from 'next/link';
import {
  prefectureSlugs,
  allBusinessTypeSlugs,
  businessTypeSlugs,
  getPrefectureSlug,
} from '@/lib/seo-constants';
import { getCitiesForPrefecture } from '@/data/city-slugs';

interface RegionGroup {
  name: string;
  prefectures: string[];
}

interface Props {
  currentPrefectureSlug: string;
  currentTypeSlug?: string;
  currentCitySlug?: string;
  regionGroup?: RegionGroup;
}

export default function RelatedLinks({ currentPrefectureSlug, currentTypeSlug, currentCitySlug, regionGroup }: Props) {
  const prefName = prefectureSlugs[currentPrefectureSlug];
  const cities = getCitiesForPrefecture(currentPrefectureSlug);

  return (
    <section className="bg-white rounded-2xl p-6 sm:p-8">
      {/* 同県の市区町村 */}
      {cities.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-bold text-gray-800 mb-3 pl-3 border-l-[3px] border-sky-500">
            {prefName}のエリア
          </h2>
          <div className="flex flex-wrap gap-2">
            {cities
              .filter(({ slug }) => slug !== currentCitySlug)
              .slice(0, 15)
              .map(({ slug, name }) => (
                <Link
                  key={slug}
                  href={currentTypeSlug ? `/${currentPrefectureSlug}/${slug}/${currentTypeSlug}` : `/${currentPrefectureSlug}/${slug}`}
                  className="px-3.5 py-1.5 bg-amber-50 border border-amber-100 rounded-full text-xs text-amber-700 hover:bg-amber-100 transition-colors"
                >
                  {name}
                </Link>
              ))}
          </div>
        </div>
      )}

      {/* 同県の他業種 */}
      <div className="mb-6">
        <h2 className="text-sm font-bold text-gray-800 mb-3 pl-3 border-l-[3px] border-sky-500">
          {prefName}の他の業種
        </h2>
        <div className="flex flex-wrap gap-2">
          {allBusinessTypeSlugs
            .filter((ts) => ts !== currentTypeSlug)
            .map((ts) => (
              <Link
                key={ts}
                href={currentCitySlug ? `/${currentPrefectureSlug}/${currentCitySlug}/${ts}` : `/${currentPrefectureSlug}/${ts}`}
                className="px-3.5 py-1.5 bg-sky-50 border border-sky-100 rounded-full text-xs text-sky-700 hover:bg-sky-100 transition-colors"
              >
                {prefName}の{businessTypeSlugs[ts]}
              </Link>
            ))}
        </div>
      </div>

      {/* 同業種の他県（業種指定時のみ） */}
      {currentTypeSlug && (
        <div className="mb-6">
          <h2 className="text-sm font-bold text-gray-800 mb-3 pl-3 border-l-[3px] border-sky-500">
            他のエリアの{businessTypeSlugs[currentTypeSlug]}
          </h2>
          <div className="flex flex-wrap gap-2">
            {(regionGroup?.prefectures || [])
              .filter((p) => p !== prefName)
              .map((p) => {
                const pSlug = getPrefectureSlug(p);
                if (!pSlug) return null;
                return (
                  <Link
                    key={pSlug}
                    href={`/${pSlug}/${currentTypeSlug}`}
                    className="px-3.5 py-1.5 bg-gray-50 border border-gray-200 rounded-full text-xs text-gray-600 hover:bg-gray-100 transition-colors"
                  >
                    {p}
                  </Link>
                );
              })}
          </div>
        </div>
      )}

      {/* 近隣の都道府県 */}
      {regionGroup && (
        <div>
          <h2 className="text-sm font-bold text-gray-800 mb-3 pl-3 border-l-[3px] border-sky-500">
            {regionGroup.name}のサロン・クリニック
          </h2>
          <div className="flex flex-wrap gap-2">
            {regionGroup.prefectures
              .filter((p) => p !== prefName)
              .map((p) => {
                const pSlug = getPrefectureSlug(p);
                if (!pSlug) return null;
                return (
                  <Link
                    key={pSlug}
                    href={`/${pSlug}`}
                    className="px-3.5 py-1.5 bg-gray-50 border border-gray-200 rounded-full text-xs text-gray-600 hover:bg-gray-100 transition-colors"
                  >
                    {p}
                  </Link>
                );
              })}
          </div>
        </div>
      )}
    </section>
  );
}
