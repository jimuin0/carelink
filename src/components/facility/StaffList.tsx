import StaffCard from './StaffCard';
import type { StaffProfile } from '@/types';

export default function StaffList({ staff, facilitySlug }: { staff: StaffProfile[]; facilitySlug: string }) {
  if (staff.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-400 text-sm">スタッフ情報はまだ登録されていません</p>
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
