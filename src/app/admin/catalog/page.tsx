import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { getCatalogsByFacility } from '@/lib/catalogs';
import { notFound } from 'next/navigation';
import Link from 'next/link';

export default async function AdminCatalogPage() {
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

  const catalogs = await getCatalogsByFacility(membership.facility_id);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">カタログ管理</h1>
        <Link href="/admin/catalog/new" className="btn-primary text-sm !py-2 !px-4">
          新規追加
        </Link>
      </div>

      {catalogs.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-400 mb-3">カタログがありません</p>
          <Link href="/admin/catalog/new" className="text-sm text-primary hover:underline">
            最初のカタログを追加
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {catalogs.map((c) => (
            <div key={c.id} className="bg-white rounded-xl p-3 shadow-sm">
              <p className="font-bold text-sm">{c.title}</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {c.tags.map((tag) => (
                  <span key={tag} className="text-micro bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
