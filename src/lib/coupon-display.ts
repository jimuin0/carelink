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

/**
 * クーポン名の先頭にある「対象」の括弧書き（例【新規】）。バッジと同じ意味のものだけを対象にする。
 * 【人気No.1】のような対象と無関係な括弧書きは店舗の表現なので消さない。
 */
const TARGET_PREFIX: Record<CouponTypeValue, RegExp> = {
  new_customer: /^(?:新規|初回)(?:限定|様|の方)?$/,
  repeat: /^(?:リピーター|リピート|再来|2回目以降)(?:限定|様|の方)?$/,
  limited_time: /^期間限定$/,
  all: /^(?:全員|全員対象|どなたでも)$/,
};
const BRACKET_PREFIX = /^\s*[【［[]([^】］\]]{1,10})[】］\]]\s*/;

/**
 * バッジ（CouponBadge）と並べて出すクーポン名。名前の先頭の【新規】などがバッジと同じことを
 * 言っているときだけ外す（2026年10月23日。「新規」バッジの横に「【新規】上まつ毛パーマ」と
 * 二重に出ていた）。外すと空になる名前はそのまま返す。
 */
export function couponDisplayName(name: string, couponType: string): string {
  const match = BRACKET_PREFIX.exec(name);
  const pattern = TARGET_PREFIX[couponType as CouponTypeValue];
  if (!match || !pattern || !pattern.test(match[1].trim())) return name;
  const rest = name.slice(match[0].length).trim();
  return rest || name;
}

/**
 * クーポンの説明が「通常¥6,900→¥5,800」のように、画面に別途出している価格（通常価格・
 * クーポン価格）を言い直しただけのものか。そうなら説明を出さない（価格が二重に出ていた）。
 * 数字・通貨記号・矢印・「通常」以外の言葉が 1 文字でも入っていれば店舗の説明として残す。
 * 数字が表示中の価格と食い違うときも残す（どちらが正しいかを画面側で決めない）。
 */
export function isPriceOnlyDescription(
  description: string,
  price: { regular: number; discounted: number },
): boolean {
  const rest = description.replace(/通常(?:価格)?|[\d,，¥￥円\s→⇒➡＞>〜～\-:：()（）]/g, '');
  if (rest !== '') return false;
  const numbers = (description.match(/\d[\d,，]*/g) ?? []).map((n) => Number(n.replace(/[,，]/g, '')));
  if (numbers.length === 0) return false;
  return numbers.every((n) => n === price.regular || n === price.discounted);
}
