import type { z } from 'zod';

/**
 * discount_type と discount_value/special_price の相互必須チェック・正規化の単一 source of truth。
 *
 * 【背景・2026年7月15日】admin作成/更新API（src/app/api/admin/coupons/route.ts・[id]/route.ts）の
 * zod は discount_type と discount_value/special_price の相互必須が無く、fixed で
 * discount_value=null（0円引き扱い）・percentage で discount_value=null（0%OFF扱い）・
 * special_price で special_price=null（0円特別価格扱い）が作成/更新できてしまっていた
 * （本番金銭バグの根本原因）。POST(discount_type必須)・PATCH(discount_type任意=部分更新)の
 * 両方で同一の相互必須ルールを共有し、意味論のドリフトを防ぐ。
 */

interface CouponDiscountFields {
  discount_type?: string;
  discount_value?: number | null;
  special_price?: number | null;
}

/**
 * discount_type に応じた discount_value/special_price の必須チェックを zod の superRefine に足す。
 * discount_type が undefined（PATCHで型を変更しない部分更新）の場合、name/is_active 等のみの
 * 更新は通すが、discount_value/special_price を送る場合は discount_type の同時指定を必須にする
 * （型が不明なまま値だけ更新できると、percentage クーポンに discount_value=150 のような
 * 型×値の相互チェックを素通りした不整合が書き込めてしまうため）。
 */
export function validateCouponDiscountFields(data: CouponDiscountFields, ctx: z.RefinementCtx): void {
  if (data.discount_type === undefined && (data.discount_value !== undefined || data.special_price !== undefined)) {
    ctx.addIssue({
      code: 'custom',
      message: '割引額/特別価格を変更する場合は割引タイプ(discount_type)も併せて指定してください',
      path: ['discount_type'],
    });
    return;
  }
  if (data.discount_type === 'fixed') {
    if (data.discount_value == null || data.discount_value < 1 || data.discount_value > 100000) {
      ctx.addIssue({
        code: 'custom',
        message: '定額割引は1円〜100,000円の範囲で入力してください',
        path: ['discount_value'],
      });
    }
  } else if (data.discount_type === 'percentage') {
    if (data.discount_value == null || data.discount_value < 1 || data.discount_value > 100) {
      ctx.addIssue({
        code: 'custom',
        message: '割合割引は1%〜100%の範囲で入力してください',
        path: ['discount_value'],
      });
    }
  } else if (data.discount_type === 'special_price') {
    if (data.special_price == null || data.special_price < 1 || data.special_price > 9999999) {
      ctx.addIssue({
        code: 'custom',
        message: '特別価格は1円以上で入力してください',
        path: ['special_price'],
      });
    }
  }
}

/**
 * discount_type に対応しない側の列を null へ正規化する（不整合データの恒久予防）。
 * 例：discount_type='fixed' で special_price に値が送られてきても null に落とす。
 *
 * discount_type が undefined（PATCHで型を変更しない部分更新）の場合は discount_value/special_price
 * に一切触れず、そのまま返す。ここで無条件に null 正規化すると、「is_active だけ更新したい」
 * ような部分更新で discount_value/special_price が意図せず null 上書きされてしまう
 * （型を送っていないのに正規化ルールだけ適用されるのは不整合）。
 */
export function normalizeCouponDiscountFields<T extends CouponDiscountFields>(data: T): T {
  if (data.discount_type == null) return data;
  return {
    ...data,
    discount_value: data.discount_type === 'special_price' ? null : (data.discount_value ?? null),
    special_price: data.discount_type === 'special_price' ? (data.special_price ?? null) : null,
  };
}
