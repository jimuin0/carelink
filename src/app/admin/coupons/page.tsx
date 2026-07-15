import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { getCouponsByFacility } from '@/lib/coupons';
import { discountText } from '@/lib/coupon-display';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import CouponBadge from '@/components/facility/CouponBadge';
import { SbPageHeader } from '@/components/admin/SbUi';

export default async function AdminCouponsPage() {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: membership } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
      .in('role', ['owner', 'admin'])
    .limit(1)
    .single();
  if (!membership) notFound();

  const coupons = await getCouponsByFacility(membership.facility_id);

  // 監査対応: 従来はクーポンの発行内容のみで利用実績(使用件数)が一切見えず、
  // 経営者がROI判断できなかった。coupon_redemptionsはRLSポリシー未整備(service role限定)
  // のため、施設の全クーポンID分をservice roleでまとめて集計する。
  const usageByCoupon = new Map<string, number>();
  if (coupons.length > 0) {
    const admin = createServiceRoleClient();
    const { data: redemptions } = await admin
      .from('coupon_redemptions')
      .select('coupon_id')
      .in('coupon_id', coupons.map((c) => c.id));
    for (const r of (redemptions ?? []) as Array<{ coupon_id: string }>) {
      usageByCoupon.set(r.coupon_id, (usageByCoupon.get(r.coupon_id) ?? 0) + 1);
    }
  }

  return (
    <div>
      <SbPageHeader title="クーポン管理" actions={
        <Link href="/admin/coupons/new" className="btn-primary text-sm !py-2 !px-4">
          新規作成
        </Link>
      } />

      {coupons.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-400 mb-3">クーポンがありません</p>
          <Link href="/admin/coupons/new" className="text-sm text-primary hover:underline">
            最初のクーポンを作成
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {coupons.map((coupon) => (
            <div key={coupon.id} className="bg-white rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <CouponBadge type={coupon.coupon_type} />
                    {coupon.valid_until && (
                      <span className="text-micro text-gray-400">
                        ~{new Date(coupon.valid_until).toLocaleDateString('ja-JP')}
                      </span>
                    )}
                  </div>
                  <p className="font-bold">{coupon.name}</p>
                  {coupon.description && <p className="text-sm text-gray-500 mt-1">{coupon.description}</p>}
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
                <Link href={`/admin/coupons/${coupon.id}/edit`} className="text-xs text-primary hover:underline ml-auto">編集</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
