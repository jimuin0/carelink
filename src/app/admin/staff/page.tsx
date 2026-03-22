import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { getStaffByFacility } from '@/lib/staff';
import { notFound } from 'next/navigation';
import Link from 'next/link';

export default async function AdminStaffPage() {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: membership } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .single();
  if (!membership) notFound();

  const staff = await getStaffByFacility(membership.facility_id);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">スタッフ管理</h1>
      </div>

      {staff.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-400">スタッフが登録されていません</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {staff.map((s) => (
            <Link
              key={s.id}
              href={`/admin/staff/${s.id}/edit`}
              className="bg-white rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow"
            >
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
                    <span key={sp} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {sp}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
