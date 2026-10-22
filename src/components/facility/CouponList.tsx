import CouponCard from './CouponCard';
import type { Coupon, FacilityMenu } from '@/types';
import { couponListPrice } from '@/lib/coupon-pricing';

const typeOrder = ['new_customer', 'repeat', 'limited_time', 'all'];

/**
 * 施設ページのクーポン一覧。
 *
 * couponMenuMap はクーポンID → 対象メニューID（coupon_menus に行があるクーポンだけキーを持つ・
 * src/lib/coupons.ts の getCouponMenuMap）。取得できなかったときは undefined。
 * 「通常 ¥X → ¥Y」はクーポンごとに対象メニューから求める（couponListPrice）。対象メニューが
 * 決まっていない・価格が分からないクーポンは、割引表記（例「20%OFF」）だけを出す。
 * 【2026年10月22日】以前は施設の全メニューの最安値（本番ではオプションの ¥500）を全クーポンの
 * 「通常価格」にしていて、「通常 ¥500 → ¥5,800」と通常価格の方が安く見えていた。
 */
export default function CouponList({ coupons, menus, couponMenuMap }: {
  coupons: Coupon[];
  menus?: FacilityMenu[];
  couponMenuMap?: Record<string, string[]>;
}) {
  if (coupons.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500 text-sm">現在利用可能なクーポンはありません</p>
      </div>
    );
  }

  const menuList = menus ?? [];
  const targetMenuNames = (couponId: string): string[] =>
    (couponMenuMap?.[couponId] ?? [])
      .map((id) => menuList.find((m) => m.id === id)?.name)
      .filter((name): name is string => !!name);

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
            <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">
              {group.type === 'new_customer' && '新規のお客様'}
              {group.type === 'repeat' && 'リピーターのお客様'}
              {group.type === 'limited_time' && '期間限定'}
              {group.type === 'all' && '全員対象'}
            </h4>
          )}
          <div className="space-y-3">
            {group.items.map((coupon) => (
              <CouponCard
                key={coupon.id}
                coupon={coupon}
                price={couponListPrice(coupon, menuList, couponMenuMap?.[coupon.id])}
                targetMenuNames={targetMenuNames(coupon.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
