import { calculateCouponDiscountedTotal, type CouponPricingMenu, type CouponPricingCoupon } from '../coupon-pricing';

const menuA: CouponPricingMenu = { id: 'menu-a', price: 10000 }; // 対象
const menuB: CouponPricingMenu = { id: 'menu-b', price: 3000 };  // 対象
const menuC: CouponPricingMenu = { id: 'menu-c', price: 2000 };  // 対象外（定価加算のみ）

describe('calculateCouponDiscountedTotal（HPB準拠・クーポン割引計算SSOT）', () => {
  // ─── クーポンなし ──────────────────────────────────────────────
  test('coupon が null → 定価合計そのまま', () => {
    expect(calculateCouponDiscountedTotal([menuA, menuC], null, undefined)).toBe(12000);
  });

  test('メニュー未選択（空配列）→ 0', () => {
    expect(calculateCouponDiscountedTotal([], { discount_type: 'fixed', discount_value: 1000, special_price: null }, undefined)).toBe(0);
  });

  // ─── 行なし(全適用・後方互換) ──────────────────────────────────
  describe('coupon_menus に行が無い（allowedMenuIds undefined/空）＝全メニュー適用（後方互換）', () => {
    test('fixed：全メニュー合計から割引', () => {
      const coupon: CouponPricingCoupon = { discount_type: 'fixed', discount_value: 1000, special_price: null };
      expect(calculateCouponDiscountedTotal([menuA, menuC], coupon, undefined)).toBe(11000); // 12000-1000
    });

    test('percentage：全メニュー合計に割引率', () => {
      const coupon: CouponPricingCoupon = { discount_type: 'percentage', discount_value: 20, special_price: null };
      expect(calculateCouponDiscountedTotal([menuA, menuC], coupon, undefined)).toBe(9600); // 12000*0.8
    });

    test('special_price：全メニュー合計を置換', () => {
      const coupon: CouponPricingCoupon = { discount_type: 'special_price', discount_value: null, special_price: 5000 };
      expect(calculateCouponDiscountedTotal([menuA, menuC], coupon, undefined)).toBe(5000);
    });

    test('allowedMenuIds が空配列（[]）でも同様に全メニュー適用扱い', () => {
      const coupon: CouponPricingCoupon = { discount_type: 'fixed', discount_value: 1000, special_price: null };
      expect(calculateCouponDiscountedTotal([menuA, menuC], coupon, [])).toBe(11000);
    });
  });

  // ─── 対象メニュー限定（HPB準拠の核心） ──────────────────────────
  describe('coupon_menus に行がある（対象メニュー限定）＝対象小計にのみ適用・対象外は定価加算', () => {
    test('fixed：対象+対象外混在 → 対象小計(13000)から割引、対象外(2000)は定価加算', () => {
      const coupon: CouponPricingCoupon = { discount_type: 'fixed', discount_value: 1000, special_price: null };
      // 対象=menuA+menuB=13000 → 1000引き=12000、対象外=menuC=2000定価 → 合計14000
      expect(calculateCouponDiscountedTotal([menuA, menuB, menuC], coupon, ['menu-a', 'menu-b'])).toBe(14000);
    });

    test('percentage：対象+対象外混在 → 対象小計にのみ割引率、対象外は定価加算（小数は対象小計側で丸め）', () => {
      const coupon: CouponPricingCoupon = { discount_type: 'percentage', discount_value: 10, special_price: null };
      // 対象=menuA+menuB=13000 → 13000*0.9=11700、対象外=menuC=2000定価 → 合計13700
      expect(calculateCouponDiscountedTotal([menuA, menuB, menuC], coupon, ['menu-a', 'menu-b'])).toBe(13700);
    });

    test('percentage：対象小計の丸め（端数切り捨てでなく四捨五入=Math.round）', () => {
      const coupon: CouponPricingCoupon = { discount_type: 'percentage', discount_value: 33, special_price: null };
      // 対象=menuA(10000) のみ選択 → 10000*0.67=6700（割り切れる例に加え、割り切れない例も検証）
      const oddMenu: CouponPricingMenu = { id: 'menu-odd', price: 999 };
      // 999 * (1-0.33) = 669.33 → round → 669
      expect(calculateCouponDiscountedTotal([oddMenu], coupon, ['menu-odd'])).toBe(669);
    });

    test('special_price：対象+対象外混在 → 対象小計を special_price に置換、対象外は定価加算', () => {
      const coupon: CouponPricingCoupon = { discount_type: 'special_price', discount_value: null, special_price: 8000 };
      // 対象=menuA+menuB(13000)→8000に置換、対象外=menuC(2000)定価 → 合計10000
      expect(calculateCouponDiscountedTotal([menuA, menuB, menuC], coupon, ['menu-a', 'menu-b'])).toBe(10000);
    });

    test('対象メニューのみ選択（対象外なし）→ 対象小計にのみ割引が適用される（従来と同額）', () => {
      const coupon: CouponPricingCoupon = { discount_type: 'fixed', discount_value: 1000, special_price: null };
      expect(calculateCouponDiscountedTotal([menuA, menuB], coupon, ['menu-a', 'menu-b'])).toBe(12000); // 13000-1000
    });

    test('対象メニューが選択されていない（呼び出し側のガード漏れ防御）→ 定価合計を返す（割引を効かせない）', () => {
      const coupon: CouponPricingCoupon = { discount_type: 'fixed', discount_value: 1000, special_price: null };
      expect(calculateCouponDiscountedTotal([menuC], coupon, ['menu-a', 'menu-b'])).toBe(2000);
    });
  });

  // ─── 0/null 境界 ──────────────────────────────────────────────
  describe('0/null 境界（既存データの防御的後方互換）', () => {
    test('fixed で discount_value が 0 → 割引なし（falsy）', () => {
      const coupon: CouponPricingCoupon = { discount_type: 'fixed', discount_value: 0, special_price: null };
      expect(calculateCouponDiscountedTotal([menuA], coupon, undefined)).toBe(10000);
    });

    test('fixed で discount_value が null → 割引なし', () => {
      const coupon: CouponPricingCoupon = { discount_type: 'fixed', discount_value: null, special_price: null };
      expect(calculateCouponDiscountedTotal([menuA], coupon, undefined)).toBe(10000);
    });

    test('percentage で discount_value が 0 → 割引なし（falsy）', () => {
      const coupon: CouponPricingCoupon = { discount_type: 'percentage', discount_value: 0, special_price: null };
      expect(calculateCouponDiscountedTotal([menuA], coupon, undefined)).toBe(10000);
    });

    test('percentage で discount_value が 100 → 0円になる（Math.max(0)ガード不要域）', () => {
      const coupon: CouponPricingCoupon = { discount_type: 'percentage', discount_value: 100, special_price: null };
      expect(calculateCouponDiscountedTotal([menuA], coupon, undefined)).toBe(0);
    });

    test('special_price が 0 → 有効な指定として採用（typeof===number判定、fixed/percentageとは基準が異なる）', () => {
      const coupon: CouponPricingCoupon = { discount_type: 'special_price', discount_value: null, special_price: 0 };
      expect(calculateCouponDiscountedTotal([menuA], coupon, undefined)).toBe(0);
    });

    test('special_price が null → 割引を適用せずメニュー定価を維持（NULL伝播防止）', () => {
      const coupon: CouponPricingCoupon = { discount_type: 'special_price', discount_value: null, special_price: null };
      expect(calculateCouponDiscountedTotal([menuA], coupon, undefined)).toBe(10000);
    });

    test('fixed の割引額がメニュー合計を超える → 0未満にならない（Math.max(0)ガード）', () => {
      const coupon: CouponPricingCoupon = { discount_type: 'fixed', discount_value: 999999, special_price: null };
      expect(calculateCouponDiscountedTotal([menuA], coupon, undefined)).toBe(0);
    });

    test('対象メニュー限定でも fixed の割引額が対象小計を超える → 対象小計側は0未満にならない', () => {
      const coupon: CouponPricingCoupon = { discount_type: 'fixed', discount_value: 999999, special_price: null };
      // 対象=menuB(3000)→0、対象外=menuC(2000)定価 → 合計2000
      expect(calculateCouponDiscountedTotal([menuB, menuC], coupon, ['menu-b'])).toBe(2000);
    });

    test('未知の discount_type → 割引なし（小計そのまま）', () => {
      const coupon = { discount_type: 'mystery', discount_value: 100, special_price: null } as CouponPricingCoupon;
      expect(calculateCouponDiscountedTotal([menuA], coupon, undefined)).toBe(10000);
    });

    test('menu.price が null のメニューは 0 円として扱う', () => {
      const freeMenu: CouponPricingMenu = { id: 'menu-free', price: null };
      expect(calculateCouponDiscountedTotal([freeMenu], null, undefined)).toBe(0);
    });

    test('対象メニュー限定・対象メニューの price が null → 対象小計は0円扱い', () => {
      const freeTargetMenu: CouponPricingMenu = { id: 'menu-free-target', price: null };
      const coupon: CouponPricingCoupon = { discount_type: 'fixed', discount_value: 1000, special_price: null };
      // 対象=0円→割引後も0（Math.max(0)）、対象外=menuC(2000)定価 → 合計2000
      expect(calculateCouponDiscountedTotal([freeTargetMenu, menuC], coupon, ['menu-free-target'])).toBe(2000);
    });

    test('対象メニュー限定・対象外メニューの price が null → 対象外小計は0円扱い', () => {
      const freeOtherMenu: CouponPricingMenu = { id: 'menu-free-other', price: null };
      const coupon: CouponPricingCoupon = { discount_type: 'fixed', discount_value: 1000, special_price: null };
      // 対象=menuA(10000)→9000、対象外=0円 → 合計9000
      expect(calculateCouponDiscountedTotal([menuA, freeOtherMenu], coupon, ['menu-a'])).toBe(9000);
    });
  });
});
