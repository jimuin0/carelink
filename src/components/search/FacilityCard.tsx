import Image from 'next/image';
import Link from 'next/link';
import type { FacilityCardData } from '@/types';

function StarRating({ rating, count }: { rating: number; count: number }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-amber-400 text-sm">{'★'.repeat(Math.round(rating))}</span>
      <span className="text-sm font-bold text-gray-700">{rating.toFixed(1)}</span>
      <span className="text-xs text-gray-400">({count}件)</span>
    </div>
  );
}

export default function FacilityCard({ facility }: { facility: FacilityCardData }) {
  return (
    <Link href={`/facility/${facility.slug}`} className="facility-card block">
      <div className="relative aspect-[16/10] bg-gray-100">
        {facility.main_photo_url ? (
          <Image
            src={facility.main_photo_url}
            alt={facility.name}
            fill
            sizes="(max-width: 640px) 100vw, 50vw"
            className="object-cover"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-300 text-4xl">
            🏢
          </div>
        )}
        <span className="absolute top-3 left-3 badge badge-primary">
          {facility.business_type}
        </span>
      </div>
      <div className="p-4">
        <h3 className="font-bold text-lg mb-1 line-clamp-1">{facility.name}</h3>
        {facility.rating_count > 0 && (
          <StarRating rating={Number(facility.rating_avg)} count={facility.rating_count} />
        )}
        {facility.catch_copy && (
          <p className="text-gray-600 text-sm mt-2 line-clamp-2">{facility.catch_copy}</p>
        )}
        <p className="text-gray-400 text-xs mt-2 flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          {facility.prefecture} {facility.city}
          {facility.access_info && ` / ${facility.access_info}`}
        </p>
      </div>
    </Link>
  );
}
