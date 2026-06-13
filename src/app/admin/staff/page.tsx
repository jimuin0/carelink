import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { getStaffByFacility } from '@/lib/staff';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SbPageHeader } from '@/components/admin/SbUi';

export default async function AdminStaffPage() {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: membership } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();
  if (!membership) notFound();

  const staff = await getStaffByFacility(membership.facility_id);

  return (
    <div>
      <SbPageHeader
        title="スタッフ管理"
        actions={<Link href="/admin/staff/new" className="btn-primary text-sm !py-2 !px-4">追加</Link>}
      />

      {staff.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-400">スタッフが登録されていません</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {staff.map((s) => (
            <div
              key={s.id}
              className="bg-white rounded-xl p-4 shadow-sm"
            >
              <Link href={`/admin/staff/${s.id}/edit`} className="block hover:opacity-80">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-sky-100 flex items-center justify-center text-sky-600 font-bold">
                    {s.name.charAt(0)}
                  </div>
                  <div>
                    <p className="font-bold">{s.name}</p>
                    {s.position && <p className="text-xs text-gray-500">{s.position}</p>}
                  </div>
                </div>
                {s.specialties?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {s.specialties?.slice(0, 3).map((sp) => (
                      <span key={sp} className="text-micro bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                        {sp}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
              <div className="flex gap-3 mt-3 pt-3 border-t">
                <Link href={`/admin/staff/${s.id}/edit`} className="text-xs text-primary hover:underline">編集</Link>
                <Link href={`/admin/staff/${s.id}/schedule`} className="text-xs text-gray-500 hover:underline">スケジュール</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
