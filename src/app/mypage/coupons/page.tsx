import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';

export const metadata: Metadata = {
  title: 'クーポン手帳 | マイページ | CareLink',
  robots: { index: false, follow: false },
};

export default async function CouponNotebookPage() {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  // Get favorite facility IDs
  const { data: favorites } = await supabase
    .from('favorites')
    .select('facility_id')
    .eq('user_id', user.id);

  const facilityIds = (favorites || []).map((f) => f.facility_id);

  let coupons: { id: string; name: string; discount_type: string; discount_value: number | null; special_price: number | null; valid_until: string | null; facility_name: string; facility_slug: string }[] = [];

  if (facilityIds.length > 0) {
    const { data } = await supabase
      .from('coupons')
      .select('id, name, discount_type, discount_value, special_price, valid_until, facility_id')
      .in('facility_id', facilityIds)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(50);

    if (data && data.length > 0) {
      // Get facility names
      const { data: profiles } = await supabase
        .from('facility_profiles')
        .select('id, name, slug')
        .in('id', facilityIds);
      const profileMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

      coupons = data.map((c) => ({
        ...c,
        facility_name: profileMap[c.facility_id]?.name || '',
        facility_slug: profileMap[c.facility_id]?.slug || '',
      }));
    }
  }

  const formatDiscount = (c: typeof coupons[0]) => {
    if (c.discount_type === 'special_price' && c.special_price !== null)
      return `¥${c.special_price.toLocaleString()}`;
    if (c.discount_type === 'percentage' && c.discount_value !== null)
      return `${c.discount_value}%OFF`;
    if (c.discount_type === 'fixed' && c.discount_value !== null)
      return `¥${c.discount_value.toLocaleString()}OFF`;
    return '';
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h1 className="text-xl font-bold mb-2">クーポン手帳</h1>
        <p className="text-sm text-gray-500">お気に入り施設のクーポンをまとめて確認できます。</p>
      </div>

      {coupons.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
          <p className="text-gray-400 mb-4">クーポンがありません</p>
          <p className="text-sm text-gray-500 mb-6">施設をお気に入りに追加すると、クーポンがここに表示されます。</p>
          <Link href="/search" className="btn-primary text-sm">施設を探す</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {coupons.map((coupon) => (
            <div key={coupon.id} className="bg-white rounded-xl shadow-sm border border-dashed border-sky-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <Link href={`/facility/${coupon.facility_slug}`} className="text-xs text-sky-600 hover:underline">
                    {coupon.facility_name}
                  </Link>
                  <p className="font-bold text-sm mt-0.5">{coupon.name}</p>
                  {coupon.valid_until && (
                    <p className="text-xs text-gray-400 mt-1">
                      有効期限: {new Date(coupon.valid_until).toLocaleDateString('ja-JP')}
                    </p>
                  )}
                </div>
                <span className="text-lg font-bold text-red-500 shrink-0">{formatDiscount(coupon)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
