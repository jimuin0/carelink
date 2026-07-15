/**
 * @jest-environment node
 *
 * calculateBookingPrice / parseDateString / availabilitySymbol（BookingFlow の純粋関数・
 * TZ非依存）の回帰テスト。
 *
 * 【2026年7月8日 実データで確定した恒久根治】
 * 1. calculateBookingPrice: 無料メニュー(price=0)でも指名スタッフの nomination_fee を加算する
 *    ことを固定する（旧実装は menuTotal===0 で指名料加算前に null を返し、サーバー側
 *    /api/booking の計算(0でも != null として指名料を加算)と食い違っていた）。
 * 2. parseDateString: UTCより時刻が遅れるタイムゾーンでも日付が繰り下がらないことを固定する
 *    （旧実装は new Date(dateStr) の直接パース→ローカルgetterで、そのようなタイムゾーンでは
 *    1日ずれた月/日/曜日を表示していた）。
 * 3. availabilitySymbol: HPB形式の週×時間マトリクスで、空きスタッフ数から◎○△×を決める
 *    境界値（0/1/2/3+）と、特定スタッフ指名時に件数によらず○/×の二値になることを固定する。
 */
import { calculateBookingPrice, parseDateString, availabilitySymbol, isCouponMenuCompatible } from '../BookingFlow';
import type { FacilityMenu, Coupon, StaffProfile } from '@/types';

function menu(price: number | null): FacilityMenu {
  return {
    id: 'm1', facility_id: 'f1', category: 'カテゴリ', name: 'メニュー', description: null,
    price, price_note: null, duration_minutes: 60, photo_url: null, is_featured: false,
    is_published: true, sort_order: 0,
  } as FacilityMenu;
}

function staff(nominationFee: number): StaffProfile {
  return {
    id: 's1', facility_id: 'f1', name: 'スタッフ', slug: 'staff', position: null, bio: null,
    specialties: [], years_experience: null, photo_url: null, instagram_url: null,
    nomination_fee: nominationFee, sort_order: 0,
  } as StaffProfile;
}

describe('calculateBookingPrice', () => {
  test('メニュー未選択 → null', () => {
    expect(calculateBookingPrice([], null, null)).toBeNull();
  });

  test('通常メニュー(有料)のみ → メニュー価格', () => {
    expect(calculateBookingPrice([menu(5000)], null, null)).toBe(5000);
  });

  test('無料メニュー(price=0)+指名なし → 0円（nullにしない）', () => {
    expect(calculateBookingPrice([menu(0)], null, null)).toBe(0);
  });

  test('無料メニュー(price=0)+指名スタッフあり → 指名料のみが合計に反映される（回帰防止の核心）', () => {
    expect(calculateBookingPrice([menu(0)], null, staff(1000))).toBe(1000);
  });

  test('有料メニュー+指名スタッフ → メニュー価格+指名料', () => {
    expect(calculateBookingPrice([menu(5000)], null, staff(1000))).toBe(6000);
  });

  test('固定額クーポン適用', () => {
    const coupon = { discount_type: 'fixed', discount_value: 1000, special_price: null } as Coupon;
    expect(calculateBookingPrice([menu(5000)], coupon, null)).toBe(4000);
  });

  test('割引率クーポン適用', () => {
    const coupon = { discount_type: 'percentage', discount_value: 20, special_price: null } as Coupon;
    expect(calculateBookingPrice([menu(5000)], coupon, null)).toBe(4000);
  });

  test('特別価格クーポン適用', () => {
    const coupon = { discount_type: 'special_price', discount_value: null, special_price: 2980 } as Coupon;
    expect(calculateBookingPrice([menu(5000)], coupon, null)).toBe(2980);
  });

  test('クーポン適用後の価格がマイナスにならない(0でクランプ)', () => {
    const coupon = { discount_type: 'fixed', discount_value: 99999, special_price: null } as Coupon;
    expect(calculateBookingPrice([menu(5000)], coupon, null)).toBe(0);
  });
});

// 【2026年7月15日 HPB準拠仕様】クーポンは対象メニュー小計にのみ効く（対象外は定価加算）。
// 計算は src/lib/coupon-pricing.ts の calculateCouponDiscountedTotal（SSOT）に一本化されており、
// ここではクライアント表示額がサーバー（/api/booking の同名関数呼び出し）と同一の実額になる
// ことを、サーバー側テスト（src/app/api/booking/__tests__/route.test.ts の混在ケース）と
// 同じ数値で固定する（表示額とサーバー請求額の一致＝ドリフト検知）。
describe('calculateBookingPrice（対象メニュー限定クーポン・allowedMenuIds）', () => {
  function menuWithId(id: string, price: number): FacilityMenu {
    return { ...menu(price), id } as FacilityMenu;
  }
  const target = menuWithId('menu-target', 10000);
  const other = menuWithId('menu-other', 2000);

  test('fixed：対象(10000)+対象外(2000)混在 → 対象のみ1000円引き＝11000（サーバーテストと同値）', () => {
    const coupon = { discount_type: 'fixed', discount_value: 1000, special_price: null } as Coupon;
    expect(calculateBookingPrice([target, other], coupon, null, ['menu-target'])).toBe(11000);
  });

  test('percentage：対象(10000)+対象外(2000)混在 → 対象のみ20%引き＝10000（旧ANY-match全額方式なら9600になり非等価・サーバーテストと同値）', () => {
    const coupon = { discount_type: 'percentage', discount_value: 20, special_price: null } as Coupon;
    expect(calculateBookingPrice([target, other], coupon, null, ['menu-target'])).toBe(10000);
  });

  test('special_price：対象(10000)+対象外(2000)混在 → 対象小計を5000に置換＝7000（サーバーテストと同値）', () => {
    const coupon = { discount_type: 'special_price', discount_value: null, special_price: 5000 } as Coupon;
    expect(calculateBookingPrice([target, other], coupon, null, ['menu-target'])).toBe(7000);
  });

  test('allowedMenuIds 未指定（行なしクーポン）→ 従来どおり全メニュー合計に適用（後方互換）', () => {
    const coupon = { discount_type: 'percentage', discount_value: 20, special_price: null } as Coupon;
    expect(calculateBookingPrice([target, other], coupon, null)).toBe(9600); // (10000+2000)*0.8
  });

  test('対象メニュー限定＋指名料 → 対象のみ割引の後に指名料を加算', () => {
    const coupon = { discount_type: 'fixed', discount_value: 1000, special_price: null } as Coupon;
    expect(calculateBookingPrice([target, other], coupon, staff(1500), ['menu-target'])).toBe(12500); // 11000+1500
  });
});

describe('parseDateString', () => {
  test('通常の日付を年月日文字列から正しく解釈する', () => {
    // 2026-07-09 は木曜日
    expect(parseDateString('2026-07-09')).toEqual({ month: 7, day: 9, dayOfWeek: 4 });
  });

  test('月初日をまたぐ日付でも1日ずれない（UTC深夜パース+ローカルTZ問題の回帰防止）', () => {
    // 2026-08-01 は土曜日
    expect(parseDateString('2026-08-01')).toEqual({ month: 8, day: 1, dayOfWeek: 6 });
  });

  test('日曜日の判定', () => {
    // 2026-07-05 は日曜日
    expect(parseDateString('2026-07-05')).toEqual({ month: 7, day: 5, dayOfWeek: 0 });
  });

  test('ローカルタイムゾーンのgetterに依存しない実装であること（回帰防止の核心）', () => {
    // 実行環境がJST(UTC+9)だと `new Date(dateStr).getDate()` 等のローカルgetterを使う旧実装
    // でも偶然ズレず、date値の一致だけを見るテストではこのバグクラスを検知できない
    // （process.env.TZ の実行時変更は Node.js/Jest の制約でテスト内から反映できないことを
    // 確認済み）。実装がローカルタイムゾーンのgetter(getDate/getMonth/getDay)を一切呼ばず、
    // TZ非依存の getUTCDay() のみを使っているという構造的事実を直接検証する。これなら
    // 実行環境のTZ設定に関係なく、旧実装(new Date(dateStr)の直接パース)への回帰を確実に検知する。
    const getDateSpy = jest.spyOn(Date.prototype, 'getDate');
    const getMonthSpy = jest.spyOn(Date.prototype, 'getMonth');
    const getDaySpy = jest.spyOn(Date.prototype, 'getDay');

    parseDateString('2026-07-09');

    expect(getDateSpy).not.toHaveBeenCalled();
    expect(getMonthSpy).not.toHaveBeenCalled();
    expect(getDaySpy).not.toHaveBeenCalled();

    getDateSpy.mockRestore();
    getMonthSpy.mockRestore();
    getDaySpy.mockRestore();
  });
});

describe('availabilitySymbol', () => {
  describe('指名なし（specific=false）: 空きスタッフ数で◎○△×を判定', () => {
    test('count=0 → ×（不可）', () => {
      expect(availabilitySymbol(0, false)).toEqual({ symbol: '×', available: false });
    });

    test('count=undefined（スロット無し）→ ×（不可・0と同じ扱い）', () => {
      expect(availabilitySymbol(undefined, false)).toEqual({ symbol: '×', available: false });
    });

    test('count=1 → △（残少）', () => {
      expect(availabilitySymbol(1, false)).toEqual({ symbol: '△', available: true });
    });

    test('count=2 → ○（空きあり）', () => {
      expect(availabilitySymbol(2, false)).toEqual({ symbol: '○', available: true });
    });

    test('count=3 → ◎（空き十分・境界値）', () => {
      expect(availabilitySymbol(3, false)).toEqual({ symbol: '◎', available: true });
    });

    test('count=4（3超）→ ◎のまま（上限クランプではなく閾値以上は全て◎）', () => {
      expect(availabilitySymbol(4, false)).toEqual({ symbol: '◎', available: true });
    });
  });

  describe('特定スタッフ指名（specific=true）: 件数によらず○/×の二値', () => {
    test('count=0 → ×', () => {
      expect(availabilitySymbol(0, true)).toEqual({ symbol: '×', available: false });
    });

    test('count=1 → ○（指名なしなら△になる件数でも、指名時は○固定）', () => {
      expect(availabilitySymbol(1, true)).toEqual({ symbol: '○', available: true });
    });

    test('count=3 → ○のまま（◎にはならない・指名は常に1名分の判定）', () => {
      expect(availabilitySymbol(3, true)).toEqual({ symbol: '○', available: true });
    });
  });
});

/**
 * 【2026年7月15日 恒久予防】クーポン×メニュー適合制約の純粋関数。
 * サーバー(src/app/api/booking/route.ts)の coupon_menus 適合チェックと同一の意味論を
 * クライアントでも検証する（disabled/警告表示のロジックが依拠する核心判定）。
 */
describe('isCouponMenuCompatible', () => {
  test('allowedMenuIds が undefined（coupon_menusに行が無い）→ 常に適合', () => {
    expect(isCouponMenuCompatible(undefined, [])).toBe(true);
    expect(isCouponMenuCompatible(undefined, ['m1'])).toBe(true);
  });

  test('allowedMenuIds が空配列（0行と同義）→ 常に適合', () => {
    expect(isCouponMenuCompatible([], ['m1'])).toBe(true);
  });

  test('allowedMenuIds があるがメニュー未選択（selectedMenuIds=[]）→ まだ不適合と決め付けず適合扱い', () => {
    expect(isCouponMenuCompatible(['m1', 'm2'], [])).toBe(true);
  });

  test('選択中メニューの少なくとも1件が対象に含まれる → 適合', () => {
    expect(isCouponMenuCompatible(['m1', 'm2'], ['m3', 'm1'])).toBe(true);
  });

  test('選択中メニューがどれも対象に含まれない → 不適合', () => {
    expect(isCouponMenuCompatible(['m1', 'm2'], ['m3', 'm4'])).toBe(false);
  });
});
