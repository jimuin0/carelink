import { notFound } from 'next/navigation';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { getCustomerVisits } from '@/lib/admin';

interface Props {
  params: { email: string };
}

export default async function CustomerDetailPage({ params }: Props) {
  let email: string;
  try {
    email = decodeURIComponent(params.email);
  } catch {
    notFound();
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) notFound();

  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: membership } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .single();
  if (!membership) notFound();

  const visits = await getCustomerVisits(membership.facility_id, email);
  const totalSpent = visits.reduce((sum, v) => sum + (v.amount ?? 0), 0);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">顧客詳細</h1>
      <p className="text-sm text-gray-500 mb-6">{email}</p>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <p className="text-sm text-gray-500">来店回数</p>
          <p className="text-2xl font-bold">{visits.length}回</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <p className="text-sm text-gray-500">合計売上</p>
          <p className="text-2xl font-bold">¥{totalSpent.toLocaleString()}</p>
        </div>
      </div>

      <h2 className="font-bold mb-3">来店履歴</h2>
      {visits.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-400">来店履歴がありません</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visits.map((v) => (
            <div key={v.id} className="bg-white rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{v.visit_date}</p>
                  {v.menu_name && <p className="text-xs text-gray-500">{v.menu_name}</p>}
                  {v.staff_name && <p className="text-xs text-gray-400">担当: {v.staff_name}</p>}
                </div>
                {v.amount !== null && (
                  <p className="font-bold">¥{v.amount.toLocaleString()}</p>
                )}
              </div>
              {v.note && <p className="text-xs text-gray-400 mt-2">{v.note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
