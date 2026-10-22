import { hasConfirmedBookingHours } from './booking-preparation';

/**
 * スタッフの週間勤務の「下書き」を、その店舗の営業時間から作る。
 *
 * 【2026年10月22日 神原さん決定】「店舗によって営業時間もシフトも違う」。
 * 以前はスタッフを追加した瞬間に DB が「毎日 09:00〜19:00」の勤務を黙って作り、
 * 営業時間とずれた分の予約枠がオーナーに知らされないまま消えていた（休みの曜日にも予約が入った）。
 * 今は追加しただけでは勤務を作らない。勤務の画面でこの下書きを見せ、オーナーが保存したときだけ登録する。
 *
 * 下書きの元にするのは「全曜日を確認して保存した営業時間」だけ（未確定の既定値は事実ではない）。
 * 確定していなければ null を返し、勝手な時間を作らない。
 */

/** staff_schedules.day_of_week（0=日〜6=土）の順に並べた business_hours のキー。 */
const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

type OpenWindow = { open: string; close: string };

export interface SuggestedStaffDay {
  day_of_week: number;
  /** 店舗の営業日なら勤務日として下書きする。定休日は休みのまま。 */
  enabled: boolean;
  start_time: string;
  end_time: string;
}

export function suggestStaffWeekFromBusinessHours(businessHours: unknown): SuggestedStaffDay[] | null {
  if (!hasConfirmedBookingHours(businessHours)) return null;
  const hours = businessHours as Record<string, OpenWindow | null>;
  const windows = DOW_KEYS.map(key => hours[key]);
  // 確定済みの営業時間には営業日が必ず1日以上ある。休みの曜日にチェックを入れたときの
  // 初期表示は、その店舗の最初の営業日の時間にする（09:00〜19:00 を持ち込まない）。
  const [firstOpen] = windows.filter((window): window is OpenWindow => window !== null);
  return windows.map((window, day) => window
    ? { day_of_week: day, enabled: true, start_time: window.open, end_time: window.close }
    : { day_of_week: day, enabled: false, start_time: firstOpen.open, end_time: firstOpen.close });
}
