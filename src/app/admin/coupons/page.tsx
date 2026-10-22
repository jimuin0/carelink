import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { getCouponsByFacility } from '@/lib/coupons';
import { discountText } from '@/lib/coupon-display';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import CouponBadge from '@/components/facility/CouponBadge';
import { SbPageHeader } from '@/components/admin/SbUi';
import FacilitySelector from '@/components/admin/FacilitySelector';
import { loadAdminFacilitySelection } from '@/lib/admin-facility-selection';
import { verifyAuthUser } from '@/lib/auth-verification';
import AccessVerificationUnavailable from '@/components/admin/AccessVerificationUnavailable';
import { databaseDiagnostic } from '@/lib/database-diagnostic';

export default async function AdminCouponsPage(props: { searchParams: Promise<{ facility_id?: string }> }) {
  const supabase = await createServerSupabaseAuthClient();
  const identity = await verifyAuthUser(supabase.auth);
  if (identity.state === 'unavailable') return <AccessVerificationUnavailable />;
  if (identity.state !== 'verified') notFound();
  const params = await props.searchParams;
  const { choices, selectedId: facilityId } = await loadAdminFacilitySelection(supabase, identity.user.id, params.facility_id ?? null);
  const selector = <FacilitySelector choices={choices} selectedId={facilityId} path="/admin/coupons" />;
  if (!facilityId) return <div><SbPageHeader title="クーポン管理" />{selector}</div>;
  const coupons = await getCouponsByFacility(facilityId);

  // Aggregate in DB, including counts above PostgREST's row cap. The gateway
  // rechecks this actor's selected store and exposes counts, not customer rows.
  const usageByCoupon = new Map<string, number>();
  if (coupons.length > 0) {
    const admin = createServiceRoleClient();
    const { data: counts, error } = await admin.rpc('get_admin_coupon_usage', {p_actor_id:identity.user.id,p_facility_id:facilityId});
    if (error) throw databaseDiagnostic(error);
    for (const r of counts ?? []) {
      if (!Number.isSafeInteger(r.usage_count) || r.usage_count < 0 || usageByCoupon.has(r.coupon_id)) throw new Error('COUPON_USAGE_UNAVAILABLE');
      usageByCoupon.set(r.coupon_id,r.usage_count);
    }
    if (coupons.some(c=>!usageByCoupon.has(c.id))) throw new Error('COUPON_USAGE_UNAVAILABLE');
  }

  return (
    <div>
      {selector}
      <SbPageHeader title="クーポン管理" actions={
        <Link href={`/admin/coupons/new?facility_id=${facilityId}`} className="btn-primary text-sm py-2! px-4!">
          新規作成
        </Link>
      } />

      {coupons.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-500 mb-3">クーポンがありません</p>
          <Link href={`/admin/coupons/new?facility_id=${facilityId}`} className="text-sm text-primary hover:underline">
            最初のクーポンを作成
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {/* 無効（is_active が true でない）クーポンも一覧に残し、編集画面から再開できるようにする。
              公開ページ・予約画面には出ない（getActiveCouponsByFacility と RLS coupons_public_read）。
              有効なものを先に、無効なものを後ろに並べる（それぞれの中では並び順を保つ）。 */}
          {[...coupons.filter((c) => c.is_active === true), ...coupons.filter((c) => c.is_active !== true)].map((coupon) => (
            <div key={coupon.id} className="bg-white rounded-xl p-4 shadow-xs">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {coupon.is_active !== true && (
                      <span className="text-micro font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">無効</span>
                    )}
                    <CouponBadge type={coupon.coupon_type} />
                    {coupon.valid_until && (
                      <span className="text-micro text-gray-500">
                        ~{new Date(coupon.valid_until).toLocaleDateString('ja-JP')}
                      </span>
                    )}
                  </div>
                  <p className="font-bold">{coupon.name}</p>
                  {coupon.description && <p className="text-sm text-gray-500 mt-1">{coupon.description}</p>}
                  {coupon.is_active !== true && (
                    <p className="text-xs text-gray-600 mt-1">お客様には表示されません。再開するには「編集」で「有効」にチェックを入れて保存してください。</p>
                  )}
                </div>
                <div className="text-right">
                  {discountText(coupon) && (
                    <p className="font-bold text-red-500">{discountText(coupon)}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 mt-3 pt-3 border-t">
                <span className="text-xs text-gray-500">
                  利用実績：<span className="font-bold text-gray-700">{usageByCoupon.get(coupon.id) ?? 0}</span>件
                </span>
                <Link href={`/admin/coupons/${coupon.id}/edit?facility_id=${facilityId}`} className="text-xs text-primary hover:underline ml-auto">編集</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
