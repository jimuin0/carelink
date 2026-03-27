import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { getUniqueCustomers } from '@/lib/admin';
import { notFound } from 'next/navigation';
import Link from 'next/link';

export default async function AdminCustomersPage() {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: membership } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();
  if (!membership) notFound();

  const customers = await getUniqueCustomers(membership.facility_id);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">顧客管理</h1>

      {customers.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-400">顧客データがありません</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">お客様名</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">メール</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500">来店回数</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">最終来店</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.email} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/admin/customers/${encodeURIComponent(c.email)}`} className="hover:text-primary">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{c.email}</td>
                    <td className="px-4 py-3 text-center">{c.visit_count}回</td>
                    <td className="px-4 py-3 text-gray-500">{c.last_visit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
