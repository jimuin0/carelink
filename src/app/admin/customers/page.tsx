import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { getUniqueCustomers } from '@/lib/admin';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SbPageHeader, SbTable, SbThead, SbTh, SbTbody, SbTd } from '@/components/admin/SbUi';

export default async function AdminCustomersPage() {
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

  const customers = await getUniqueCustomers(membership.facility_id);

  return (
    <div>
      <SbPageHeader title="顧客管理" />

      {customers.length > 0 && (
        <div className="mb-4 flex justify-end">
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(
              '\uFEFF' + 'お客様名,メール,来店回数,最終来店\n' +
              customers.map((c: { name: string; email: string; visit_count: number; last_visit: string }) =>
                `${c.name},${c.email},${c.visit_count},${c.last_visit}`
              ).join('\n')
            )}`}
            download="customers.csv"
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            📥 CSVダウンロード
          </a>
        </div>
      )}

      {customers.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-400">顧客データがありません</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <SbTable>
            <SbThead>
              <SbTh>お客様名</SbTh>
              <SbTh>メール</SbTh>
              <SbTh align="center">来店回数</SbTh>
              <SbTh>最終来店</SbTh>
            </SbThead>
            <SbTbody>
              {customers.map((c) => (
                <tr key={c.email} className="hover:bg-gray-50">
                  <SbTd className="font-medium">
                    <Link href={`/admin/customers/${encodeURIComponent(c.email)}`} className="hover:text-primary">
                      {c.name}
                    </Link>
                  </SbTd>
                  <SbTd className="text-gray-500">{c.email}</SbTd>
                  <SbTd align="center">{c.visit_count}回</SbTd>
                  <SbTd className="text-gray-500">{c.last_visit}</SbTd>
                </tr>
              ))}
            </SbTbody>
          </SbTable>
        </div>
      )}
    </div>
  );
}
