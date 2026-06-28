// 来院者 予約完走 E2E の共有定数。
// booking-complete.setup.ts が CI の隔離 Supabase に「予約可能な施設」（公開＋スタッフ＋
// 全曜日スケジュール＋メニュー）を service role で seed し、slug をファイルに書き出す。
// booking-complete.spec.ts がその slug の施設で匿名予約を完走する。本番不可侵。

export const BOOKING_FACILITY_FILE = 'e2e/.auth/booking-facility.json';

export const BOOKING_SEED = {
  menuName: 'E2Eテストカット',
  menuPrice: 8000,
  menuDuration: 60,
  staffName: 'E2E予約担当',
  customerName: 'E2E予約太郎',
  customerEmail: 'e2e-booking@example.invalid',
};
