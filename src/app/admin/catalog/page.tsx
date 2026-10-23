import { readPageResult } from '@/lib/page-read-verification';
import { verifyAuthUser } from '@/lib/auth-verification';
import AccessVerificationUnavailable from '@/components/admin/AccessVerificationUnavailable';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { loadAdminFacilitySelection } from '@/lib/admin-facility-selection';
import FacilitySelector from '@/components/admin/FacilitySelector';
import type { TreatmentCatalog } from '@/types';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SbPageHeader } from '@/components/admin/SbUi';

export default async function AdminCatalogPage(props: { searchParams: Promise<{ facility_id?: string }> }) {
  const supabase = await createServerSupabaseAuthClient();
  const identity = await verifyAuthUser(supabase.auth);
  if (identity.state === 'unavailable') return <AccessVerificationUnavailable />;
  if (identity.state !== 'verified') notFound();
  const user = identity.user;

  // 複数店舗のオーナーは ?facility_id= で店舗を選ぶ（2026年10月22日）。以前は facility_members を
  // .limit(1) で 1 行だけ読み、2 店舗目のカタログを一覧も作成もできなかった。
  const { facility_id: requested } = await props.searchParams;
  const { choices, selectedId: facilityId } = await loadAdminFacilitySelection(supabase, user.id, requested ?? null);
  if (choices.length === 0) notFound();
  const selector = <FacilitySelector choices={choices} selectedId={facilityId} path="/admin/catalog" />;
  if (!facilityId) return <div><SbPageHeader title="カタログ管理" />{selector}</div>;

  const { data: catalogRows } = await readPageResult(() => supabase.from('treatment_catalogs')
    .select('*').eq('facility_id', facilityId).order('created_at', { ascending: false }), '/admin/catalog');
  const catalogs = (catalogRows ?? []) as TreatmentCatalog[];
  const newHref = `/admin/catalog/new?facility_id=${facilityId}`;

  return (
    <div>
      {selector}
      <SbPageHeader title="カタログ管理" actions={
        <Link href={newHref} className="btn-primary text-sm py-2! px-4!">
          新規追加
        </Link>
      } />

      {catalogs.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-500 mb-3">カタログがありません</p>
          <Link href={newHref} className="text-sm text-primary hover:underline">
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
              <Link href={`/admin/catalog/${c.id}/edit?facility_id=${facilityId}`} className="text-xs text-primary hover:underline mt-2 inline-block">
                編集
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
