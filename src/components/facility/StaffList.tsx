import StaffCard from './StaffCard';
import type { StaffProfile } from '@/types';

export default function StaffList({ staff, facilitySlug }: { staff: StaffProfile[]; facilitySlug: string }) {
  if (staff.length === 0) {
    return (
      <div className="text-center py-10 bg-gray-50 rounded-xl">
        <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <p className="text-gray-500 text-sm font-medium">スタッフ情報はまだ登録されていません</p>
        <p className="text-gray-400 text-xs mt-1">施設の担当スタッフが決まり次第、ご紹介いたします</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
      {staff.map((s) => (
        <StaffCard key={s.id} staff={s} facilitySlug={facilitySlug} />
      ))}
    </div>
  );
}
