import type { Coupon } from '@/types';
import CouponBadge from './CouponBadge';
import { couponDisplayName, discountText, isPriceOnlyDescription } from '@/lib/coupon-display';
import { couponTargetCondition } from '@/lib/coupon-eligibility';
import type { CouponListPrice } from '@/lib/coupon-pricing';

/**
 * price は対象メニューから求めた「通常 ¥X → ¥Y」（src/lib/coupon-pricing.ts の couponListPrice）。
 * null のときは取り消し線の通常価格を出さず、割引表記だけを出す（正直に出せない値を作らない）。
 *
 * 同じことを二度言わない（2026年10月23日）。
 * - 名前の先頭の【新規】などはバッジと同じ意味なので外す（couponDisplayName）。
 * - 説明が「通常¥6,900→¥5,800」のように右側の価格の言い直しだけなら説明を出さない。
 * 価格の色は「取り消し線＝割引前」「赤＝割引後のクーポン価格」だけ（FacilityCard と同じ決まり）。
 */
export default function CouponCard({ coupon, price = null, targetMenuNames = [] }: {
  coupon: Coupon;
  price?: CouponListPrice | null;
  targetMenuNames?: string[];
}) {
  const discount = discountText(coupon);
  const condition = couponTargetCondition(coupon.coupon_type);
  const showDescription = !!coupon.description && !(price && isPriceOnlyDescription(coupon.description, price));

  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-white">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <CouponBadge type={coupon.coupon_type} />
            {coupon.valid_until && (
              <span className="text-micro text-gray-500">
                ~{new Date(coupon.valid_until).toLocaleDateString('ja-JP')}
              </span>
            )}
          </div>
          <p className="font-bold text-sm">{couponDisplayName(coupon.name, coupon.coupon_type)}</p>
          {showDescription && (
            <p className="text-xs text-gray-500 mt-1">{coupon.description}</p>
          )}
          {targetMenuNames.length > 0 && (
            <p className="text-xs text-gray-600 mt-1">対象メニュー：{targetMenuNames.join('、')}</p>
          )}
          {condition && (
            <p className="text-xs text-gray-600 mt-1">ご利用条件：{condition}（ログインが必要です）</p>
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
