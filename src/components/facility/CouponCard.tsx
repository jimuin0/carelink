import type { Coupon } from '@/types';
import CouponBadge from './CouponBadge';

function formatDiscount(coupon: Coupon): string {
  if (coupon.discount_type === 'special_price' && coupon.special_price !== null) {
    return `¥${coupon.special_price.toLocaleString()}`;
  }
  if (coupon.discount_type === 'percentage' && coupon.discount_value !== null) {
    return `${coupon.discount_value}%OFF`;
  }
  if (coupon.discount_type === 'fixed' && coupon.discount_value !== null) {
    return `¥${coupon.discount_value.toLocaleString()}OFF`;
  }
  return '';
}

export default function CouponCard({ coupon }: { coupon: Coupon }) {
  const discount = formatDiscount(coupon);

  return (
    <div className="border border-dashed border-sky-300 rounded-xl p-4 bg-sky-50/30">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <CouponBadge type={coupon.coupon_type} />
            {coupon.valid_until && (
              <span className="text-micro text-gray-400">
                ~{new Date(coupon.valid_until).toLocaleDateString('ja-JP')}
              </span>
            )}
          </div>
          <p className="font-bold text-sm">{coupon.name}</p>
          {coupon.description && (
            <p className="text-xs text-gray-500 mt-1">{coupon.description}</p>
          )}
        </div>
        {discount && (
          <div className="text-right shrink-0">
            <p className="font-bold text-lg text-red-500">{discount}</p>
          </div>
        )}
      </div>
    </div>
  );
}
