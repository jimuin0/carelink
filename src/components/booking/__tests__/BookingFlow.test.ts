/**
 * @jest-environment node
 *
 * calculateBookingPrice / parseDateString（BookingFlow の純粋関数・TZ非依存）の回帰テスト。
 *
 * 【2026年7月8日 実データで確定した恒久根治】
 * 1. calculateBookingPrice: 無料メニュー(price=0)でも指名スタッフの nomination_fee を加算する
 *    ことを固定する（旧実装は menuTotal===0 で指名料加算前に null を返し、サーバー側
 *    /api/booking の計算(0でも != null として指名料を加算)と食い違っていた）。
 * 2. parseDateString: UTCより時刻が遅れるタイムゾーンでも日付が繰り下がらないことを固定する
 *    （旧実装は new Date(dateStr) の直接パース→ローカルgetterで、そのようなタイムゾーンでは
 *    1日ずれた月/日/曜日を表示していた）。
 */
import { calculateBookingPrice, parseDateString } from '../BookingFlow';
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
