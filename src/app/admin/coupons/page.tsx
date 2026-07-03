import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { getCouponsByFacility } from '@/lib/coupons';
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
                  {coupon.discount_type === 'fixed' && coupon.discount_value && (
                    <p className="font-bold text-red-500">¥{coupon.discount_value.toLocaleString()}OFF</p>
                  )}
                  {coupon.discount_type === 'percentage' && coupon.discount_value && (
                    <p className="font-bold text-red-500">{coupon.discount_value}%OFF</p>
                  )}
                  {coupon.discount_type === 'special_price' && coupon.special_price !== null && (
                    <p className="font-bold text-red-500">¥{coupon.special_price.toLocaleString()}</p>
                  )}
                </div>
              </div>
              <div className="flex gap-3 mt-3 pt-3 border-t">
                <Link href={`/admin/coupons/${coupon.id}/edit`} className="text-xs text-primary hover:underline">編集</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
