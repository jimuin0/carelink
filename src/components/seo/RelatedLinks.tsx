import Link from 'next/link';
import {
  prefectureSlugs,
  allBusinessTypeSlugs,
  businessTypeSlugs,
  getPrefectureSlug,
} from '@/lib/seo-constants';

interface RegionGroup {
  name: string;
  prefectures: string[];
}

interface Props {
  currentPrefectureSlug: string;
  currentTypeSlug?: string;
  regionGroup?: RegionGroup;
}

export default function RelatedLinks({ currentPrefectureSlug, currentTypeSlug, regionGroup }: Props) {
  const prefName = prefectureSlugs[currentPrefectureSlug];

  return (
    <section className="bg-white rounded-2xl p-6 sm:p-8">
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
                href={`/${currentPrefectureSlug}/${ts}`}
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
