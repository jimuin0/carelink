import type { Facility } from '@/types';
import ViewingNow from './ViewingNow';

export default function FacilityHeader({ facility }: { facility: Facility }) {
  return (
    <div className="px-4 sm:px-6 py-5">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="badge badge-primary">{facility.business_type}</span>
        {facility.rating_count > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-amber-400">★</span>
            <span className="text-sm font-bold">{Number(facility.rating_avg).toFixed(1)}</span>
            <span className="text-xs text-gray-400">({facility.rating_count}件)</span>
          </div>
        )}
        {facility.view_count > 0 && (
          <span className="text-xs text-gray-400">閲覧 {facility.view_count.toLocaleString()}回</span>
        )}
        <ViewingNow viewCount={facility.view_count} />
      </div>
      <h1 className="text-xl sm:text-2xl font-bold mb-2">{facility.name}</h1>
      {facility.catch_copy && (
        <p className="text-gray-600 text-sm bg-sky-50 rounded-lg px-3 py-2 border-l-[3px] border-sky-400">{facility.catch_copy}</p>
      )}
    </div>
  );
}
