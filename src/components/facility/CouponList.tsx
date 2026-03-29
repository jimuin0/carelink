import CouponCard from './CouponCard';
import type { Coupon, FacilityMenu } from '@/types';

const typeOrder = ['new_customer', 'repeat', 'limited_time', 'all'];

export default function CouponList({ coupons, menus }: { coupons: Coupon[]; menus?: FacilityMenu[] }) {
  const representativePrice = menus && menus.length > 0
    ? Math.min(...menus.filter((m) => m.price != null).map((m) => m.price as number))
    : null;
  if (coupons.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-400 text-sm">現在利用可能なクーポンはありません</p>
      </div>
    );
  }

  // Group by coupon_type
  const grouped = typeOrder
    .map((type) => ({
      type,
      items: coupons.filter((c) => c.coupon_type === type),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      {grouped.map((group) => (
        <div key={group.type}>
          {grouped.length > 1 && (
            <h4 className="text-xs font-bold text-gray-400 uppercase mb-2">
              {group.type === 'new_customer' && '新規のお客様'}
              {group.type === 'repeat' && 'リピーターのお客様'}
              {group.type === 'limited_time' && '期間限定'}
              {group.type === 'all' && '全員対象'}
            </h4>
          )}
          <div className="space-y-3">
            {group.items.map((coupon) => (
              <CouponCard key={coupon.id} coupon={coupon} menuPrice={representativePrice} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
