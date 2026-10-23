import { getNearbyForFacilityPage } from '@/lib/related-facilities';
import FacilityCard from '@/components/search/FacilityCard';
import Link from 'next/link';
import { formatFacilityLocality } from '@/lib/facility-location';

interface Props {
  facilityId: string;
  /** 「似たサロン」と同じ店を重ねて出さないために使う（その欄の条件が業種＋都道府県のため）。 */
  businessType: string;
  prefecture: string;
  city: string;
}

export default async function NearbyFacilities({ facilityId, businessType, prefecture, city }: Props) {
  const facilities = await getNearbyForFacilityPage(facilityId, businessType, prefecture, city);
  if (facilities.length === 0) return null;

  return (
    <section className="px-4 sm:px-6 py-8 border-t border-gray-100">
      <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
        <span className="w-1 h-5 bg-sky-500 rounded-full" />
        {formatFacilityLocality(prefecture, city)}の他のサロン
      </h3>
      <div className="grid sm:grid-cols-2 gap-4">
        {facilities.map((f) => (
          <FacilityCard key={f.id} facility={f} showBadges={false} />
        ))}
      </div>
      <div className="text-center mt-4">
        <Link
          href={`/search?area=${encodeURIComponent(prefecture)}`}
          className="text-sm text-sky-700 hover:underline"
        >
          {prefecture}のサロンをもっと見る &rsaquo;
        </Link>
      </div>
    </section>
  );
}
