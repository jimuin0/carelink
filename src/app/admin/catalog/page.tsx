import { readPageResult } from '@/lib/page-read-verification';
import { verifyAuthUser } from '@/lib/auth-verification';
import AccessVerificationUnavailable from '@/components/admin/AccessVerificationUnavailable';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import type { TreatmentCatalog } from '@/types';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SbPageHeader } from '@/components/admin/SbUi';

export default async function AdminCatalogPage() {
  const supabase = await createServerSupabaseAuthClient();
  const identity = await verifyAuthUser(supabase.auth);
  if (identity.state === 'unavailable') return <AccessVerificationUnavailable />;
  if (identity.state !== 'verified') notFound();
  const user = identity.user;

  const { data: membership } = await readPageResult(() => supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
      .in('role', ['owner', 'admin'])
    .limit(1)
    .maybeSingle(), '/admin/catalog');
  if (!membership) notFound();

  const { data: catalogRows } = await readPageResult(() => supabase.from('treatment_catalogs')
    .select('*').eq('facility_id', membership.facility_id).order('created_at', { ascending: false }), '/admin/catalog');
  const catalogs = (catalogRows ?? []) as TreatmentCatalog[];

  return (
    <div>
      <SbPageHeader title="カタログ管理" actions={
        <Link href="/admin/catalog/new" className="btn-primary text-sm py-2! px-4!">
          新規追加
        </Link>
      } />

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
            <div key={c.id} className="bg-white rounded-xl p-3 shadow-xs">
              <p className="font-bold text-sm">{c.title}</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {(c.tags ?? []).map((tag) => (
                  <span key={tag} className="text-micro bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                    {tag}
                  </span>
                ))}
              </div>
              <Link href={`/admin/catalog/${c.id}/edit`} className="text-xs text-primary hover:underline mt-2 inline-block">
                編集
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
