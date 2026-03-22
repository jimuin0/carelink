import Image from 'next/image';
import Link from 'next/link';
import type { StaffProfile } from '@/types';

export default function StaffCard({ staff, facilitySlug }: { staff: StaffProfile; facilitySlug: string }) {
  return (
    <Link
      href={`/facility/${facilitySlug}/staff/${staff.slug}`}
      className="bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-md transition-shadow"
    >
      <div className="relative aspect-square bg-gray-100">
        {staff.photo_url ? (
          <Image
            src={staff.photo_url}
            alt={staff.name}
            fill
            sizes="(max-width: 640px) 50vw, 33vw"
            className="object-cover"
          />
        ) : (
          <div className="flex items-center justify-center h-full bg-gradient-to-br from-sky-50 to-sky-100">
            <svg className="w-12 h-12 text-sky-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="font-bold text-sm">{staff.name}</p>
        {staff.position && (
          <p className="text-xs text-gray-500 mt-0.5">{staff.position}</p>
        )}
        {staff.specialties.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {staff.specialties.slice(0, 3).map((s) => (
              <span key={s} className="text-[10px] bg-sky-50 text-sky-600 px-2 py-0.5 rounded-full">
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
