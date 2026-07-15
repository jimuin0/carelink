/**
 * クーポン割引計算の単一 source of truth（HPB＝ホットペッパービューティー準拠仕様・2026年7月15日導入）。
 *
 * 【背景】従来の実装は「クーポンが選択メニュー合計の全額に効く」ANY-match方式だった
 * （coupon_menus に対象メニューの行があっても、選択メニューのどれか1つが対象なら選択メニュー
 * 全額に割引がかかっていた＝#476時点）。HPB準拠仕様はこれを「クーポンは対象メニューの小計にのみ
 * 効く」方式に変更する：
 *
 * - coupon_menus に行が【ある】クーポン（対象メニュー限定）：
 *   - special_price：対象メニュー小計を special_price に「置換」。対象外メニューは定価のまま加算。
 *   - fixed/percentage：対象メニュー小計にのみ適用。対象外メニューは定価のまま加算。
 * - coupon_menus に行が【無い】クーポン（本番全20件は現状こちら）：
 *   - 従来どおり全メニュー合計に適用（後方互換・挙動変化ゼロ）。
 *
 * この関数は src/components/booking/BookingFlow.tsx（クライアント・表示用）と
 * src/app/api/booking/route.ts（サーバー・課金額決定＝権威）の両方から呼ばれる。
 * 二重実装によるドリフト（クライアント表示額とサーバー請求額の不一致）を構造的に根絶するため、
 * 計算ロジックはこの1関数にのみ存在する。
 */

export interface CouponPricingMenu {
  id: string;
  price: number | null;
}

export interface CouponPricingCoupon {
  discount_type: string;
  discount_value: number | null;
  special_price: number | null;
}

/**
 * 割引前の小計に対して coupon の discount_type に応じた割引後金額を返す（内部ヘルパ）。
 * discount_value/special_price が該当型に対して欠落（null/undefined）または 0（falsy）の場合は
 * 割引を適用せず小計をそのまま返す（既存実装からの後方互換。0円引き/0%OFF自体は
 * admin作成/更新APIのzodで新規作成不可になったが、既存データの防御としてここでも維持する）。
 * special_price のみ typeof===number チェック（0円特別価格を有効な指定として扱うため、他の型と
 * 判定基準を分けている＝既存実装からの踏襲）。
 */
function applyDiscountToSubtotal(subtotal: number, coupon: CouponPricingCoupon): number {
  if (coupon.discount_type === 'fixed' && coupon.discount_value) {
    return Math.max(0, subtotal - coupon.discount_value);
  }
  if (coupon.discount_type === 'percentage' && coupon.discount_value) {
    return Math.max(0, Math.round(subtotal * (1 - coupon.discount_value / 100)));
  }
  if (coupon.discount_type === 'special_price' && typeof coupon.special_price === 'number') {
    return coupon.special_price;
  }
  return subtotal;
}

/**
 * 選択中メニュー群にクーポンを適用した合計金額を計算する（指名料・ポイント控除は含まない＝
 * それぞれ呼び出し側で別途加算/控除する）。
 *
 * @param menus 選択中メニュー（id・price のみ参照）。
 * @param coupon 適用するクーポン（null なら割引なし＝定価合計）。
 * @param allowedMenuIds coupon_menus から取得した対象メニューID配列。
 *   undefined または空配列＝対象メニュー限定なし（全メニュー適用・後方互換）。
 *   非空配列＝対象メニュー限定（対象小計にのみ割引・対象外は定価加算）。
 */
export function calculateCouponDiscountedTotal(
  menus: CouponPricingMenu[],
  coupon: CouponPricingCoupon | null,
  allowedMenuIds: string[] | undefined,
): number {
  const menuTotal = menus.reduce((sum, m) => sum + (m.price ?? 0), 0);
  if (!coupon) return menuTotal;

  const isRestricted = !!allowedMenuIds && allowedMenuIds.length > 0;
  if (!isRestricted) {
    return applyDiscountToSubtotal(menuTotal, coupon);
  }

  const allowedSet = new Set(allowedMenuIds);
  const targetMenus = menus.filter((m) => allowedSet.has(m.id));
  const otherMenus = menus.filter((m) => !allowedSet.has(m.id));

  // 対象メニューが選択されていない場合（呼び出し側で本来ガードされるべき状態・fail-closedの
  // 手前で到達した場合の防御）は割引を適用せず定価合計を返す。無言で割引を適用してしまうと
  // 対象外なのに割引が乗る金銭バグになるため、割引を「効かせない」方向に倒す。
  if (targetMenus.length === 0) return menuTotal;

  const targetSubtotal = targetMenus.reduce((sum, m) => sum + (m.price ?? 0), 0);
  const otherSubtotal = otherMenus.reduce((sum, m) => sum + (m.price ?? 0), 0);
  const discountedTarget = applyDiscountToSubtotal(targetSubtotal, coupon);
  return discountedTarget + otherSubtotal;
}
