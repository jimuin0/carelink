import Image from 'next/image';
import Link from 'next/link';
import type { StaffProfile } from '@/types';
import PreferredStaffButton from './PreferredStaffButton';
import StaffMonogram from './StaffMonogram';

/**
 * スタッフ一覧のカード。プロフィールへのリンクと「指名登録」ボタンを並べる。
 * ボタンをリンクの中に入れると操作要素が入れ子になり押し分けられないため、
 * リンクは写真と名前の部分だけにして、ボタンはその下に置く。
 */
export default function StaffCard({ staff, facilitySlug }: { staff: StaffProfile; facilitySlug: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-md transition-shadow flex flex-col">
      <Link href={`/facility/${facilitySlug}/staff/${staff.slug}`} className="block flex-1">
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
            <StaffMonogram name={staff.name} className="text-5xl" />
          )}
        </div>
        <div className="p-3">
          <p className="font-bold text-sm">{staff.name}</p>
          {staff.position && (
            <p className="text-xs text-gray-500 mt-0.5">{staff.position}</p>
          )}
          {staff.specialties?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {staff.specialties?.slice(0, 3).map((s) => (
                <span key={s} className="text-micro bg-sky-50 text-sky-700 px-2 py-0.5 rounded-full">
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
      </Link>
      <div className="px-3 pb-3">
        <PreferredStaffButton staffId={staff.id} staffName={staff.name} variant="card" />
      </div>
    </div>
  );
}
