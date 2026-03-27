import { getSimilarFacilities } from '@/lib/facilities';
import FacilityCard from '@/components/search/FacilityCard';

interface Props {
  facilityId: string;
  businessType: string;
  prefecture: string;
}

export default async function SimilarFacilities({ facilityId, businessType, prefecture }: Props) {
  const facilities = await getSimilarFacilities(facilityId, businessType, prefecture);
  if (facilities.length === 0) return null;

  return (
    <section className="px-4 sm:px-6 py-8 border-t border-gray-100">
      <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
        <span className="w-1 h-5 bg-sky-500 rounded-full" />
        似たサロン・クリニック
      </h3>
      <div className="grid sm:grid-cols-2 gap-4">
        {facilities.map((f) => (
          <FacilityCard key={f.id} facility={f} showBadges={false} />
        ))}
      </div>
    </section>
  );
}
