import FacilityCard from '@/components/search/FacilityCard';
import type { FacilityCardData } from '@/types';

interface Props {
  facilities: FacilityCardData[];
}

export default function SimilarFacilities({ facilities }: Props) {
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
