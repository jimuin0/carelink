import type { Coupon } from '@/types';
import CouponBadge from './CouponBadge';
import { discountText } from '@/lib/coupon-display';
import { couponTargetCondition } from '@/lib/coupon-eligibility';
import type { CouponListPrice } from '@/lib/coupon-pricing';

/**
 * price は対象メニューから求めた「通常 ¥X → ¥Y」（src/lib/coupon-pricing.ts の couponListPrice）。
 * null のときは取り消し線の通常価格を出さず、割引表記だけを出す（正直に出せない値を作らない）。
 */
export default function CouponCard({ coupon, price = null, targetMenuNames = [] }: {
  coupon: Coupon;
  price?: CouponListPrice | null;
  targetMenuNames?: string[];
}) {
  const discount = discountText(coupon);
  const condition = couponTargetCondition(coupon.coupon_type);

  return (
    <div className="border border-dashed border-sky-300 rounded-xl p-4 bg-sky-50/30">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <CouponBadge type={coupon.coupon_type} />
            {coupon.valid_until && (
              <span className="text-micro text-gray-500">
                ~{new Date(coupon.valid_until).toLocaleDateString('ja-JP')}
              </span>
            )}
          </div>
          <p className="font-bold text-sm">{coupon.name}</p>
          {coupon.description && (
            <p className="text-xs text-gray-500 mt-1">{coupon.description}</p>
          )}
          {targetMenuNames.length > 0 && (
            <p className="text-xs text-gray-600 mt-1">対象メニュー：{targetMenuNames.join('、')}</p>
          )}
          {condition && (
            <p className="text-xs text-gray-600 mt-1">ご利用条件：{condition}</p>
          )}
        </div>
        {(price || discount) && (
          <div className="text-right shrink-0">
            {price ? (
              <>
                <p className="text-xs text-gray-500 line-through">通常 ¥{price.regular.toLocaleString()}</p>
                <p className="font-bold text-lg text-red-600">¥{price.discounted.toLocaleString()}</p>
              </>
            ) : (
              <p className="font-bold text-lg text-red-600">{discount}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
