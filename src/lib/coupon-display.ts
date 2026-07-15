/**
 * クーポン表示ロジックの単一 source of truth。
 *
 * discount_type（'fixed' | 'percentage' | 'special_price'）・coupon_type
 * （'new_customer' | 'repeat' | 'limited_time' | 'all'）は
 * supabase/migrations/20260323000002_phase3_staff_coupons.sql の DB CHECK 制約が正。
 *
 * 以前は discountText 相当のロジックが画面ごとに手書きされ、src/app/liff/coupons/page.tsx
 * だけが誤った値集合（discount_type='percent'/'fixed'/'special'、coupon_type='limited'）を
 * 参照していた（2026-07-15 発見）。DB 上は 'percentage'/'special_price'/'limited_time' の
 * ため、該当画面では percentage・special_price クーポンが常に「特別割引」に、limited_time
 * クーポンが常に「全員」に誤表示されるドリフトが発生していた。本モジュールに集約し、
 * 画面ごとの値集合の再実装（＝ドリフトの再発余地）を無くす。
 */

/** DB CHECK 制約と一致する discount_type の正準値集合。 */
export type CouponDiscountType = 'fixed' | 'percentage' | 'special_price';

/** DB CHECK 制約と一致する coupon_type の正準値集合。 */
export type CouponTypeValue = 'new_customer' | 'repeat' | 'limited_time' | 'all';

export interface DiscountDisplayInput {
  discount_type: string;
  discount_value: number | null;
  special_price: number | null;
}

/**
 * 割引表示文字列を返す（例: "20%OFF" / "¥500OFF" / "¥3,000"）。
 * discount_type が未知、または対応する金額が null の場合は fallback を返す。
 * fallback は画面ごとに既存の文言が異なる（liff/coupons は「特別割引」・他は空文字）ため
 * 引数化し、この関数への集約で各画面の表示文言を壊さないようにする。
 */
export function discountText(coupon: DiscountDisplayInput, fallback = ''): string {
  if (coupon.discount_type === 'special_price' && coupon.special_price !== null) {
    return `¥${coupon.special_price.toLocaleString()}`;
  }
  if (coupon.discount_type === 'percentage' && coupon.discount_value !== null) {
    return `${coupon.discount_value}%OFF`;
  }
  if (coupon.discount_type === 'fixed' && coupon.discount_value !== null) {
    return `¥${coupon.discount_value.toLocaleString()}OFF`;
  }
  return fallback;
}

/** coupon_type → 表示ラベル（src/app/liff/coupons/page.tsx の既存文言を正準値集合で再実装）。 */
const COUPON_TYPE_LABEL: Record<CouponTypeValue, string> = {
  new_customer: '新規限定',
  repeat: 'リピーター',
  limited_time: '期間限定',
  all: '全員',
};

/** coupon_type → 表示ラベル（未知値・'all' は『全員』を返す）。 */
export function couponTypeLabel(couponType: string): string {
  return COUPON_TYPE_LABEL[couponType as CouponTypeValue] ?? COUPON_TYPE_LABEL.all;
}
