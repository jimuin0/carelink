import type { SupabaseClient } from '@supabase/supabase-js';
import { readWorkingStaff, workingTimeMeetsBusinessHours } from './facility-publish-gate';

/**
 * 勤務時間・営業時間を保存したときに店舗へ返す注意書き（保存は止めない・2026年10月23日）。
 *
 * 予約枠（get_available_slots）は勤務の窓を営業時間で切り詰め、定休日は枠を出さない。営業時間の外にしか
 * 勤務が無いと、保存は成功に見えるのに予約画面は毎日「満枠」になる。保存の瞬間に気づけるよう、
 * 判定（workingTimeMeetsBusinessHours・SQL 側は public.working_time_meets_business_hours）と同じ規則で
 * 重ならない勤務を知らせる。営業時間とシフトは店舗ごとに違ってよい（神原さん決定 2026年10月22日）ので、
 * 断らずに注意だけを返す。
 */

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

export interface WeeklyWindow {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

/** 週間の勤務のうち、営業時間（定休日を含む）と重ならない曜日を知らせる。全部重なれば null。 */
export function weeklyScheduleHoursWarning(businessHours: unknown, schedules: readonly WeeklyWindow[]): string | null {
  const outside = schedules
    .filter(s => !workingTimeMeetsBusinessHours(businessHours, s.day_of_week, s.start_time, s.end_time))
    .map(s => s.day_of_week)
    .sort((a, b) => a - b);
  if (outside.length === 0) return null;
  const days = outside.map(day => DAY_LABELS[day]).join('・');
  const message = `${days}曜の勤務時間は店舗の営業時間（定休日を含む）と重なっていないため、その曜日はネット予約の枠が出ません。`;
  return outside.length === schedules.length
    ? `${message}このままでは、このスタッフは週間の勤務ではネット予約を受けられません。店舗の営業時間か勤務時間を見直してください。`
    : message;
}

/** 勤務する特別日が、その曜日の営業時間（定休日を含む）と重ならなければ知らせる。 */
export function specialDayHoursWarning(businessHours: unknown, date: string, start: string, end: string): string | null {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return workingTimeMeetsBusinessHours(businessHours, day, start, end)
    ? null
    : 'この特別日の勤務時間は店舗の営業時間（定休日を含む）と重なっていないため、この日はネット予約の枠が出ません。';
}

/** 営業時間を保存した結果、勤務の窓が営業時間と重なる在籍スタッフが 1 人もいなくなったときの注意。 */
export const NO_STAFF_INSIDE_HOURS_WARNING =
  '保存した営業時間と重なる勤務時間のスタッフがいないため、ネット予約の枠が出ません。スタッフの勤務時間を見直してください。';

/**
 * 営業時間を保存した後の注意。勤務時間を保存した在籍スタッフはいるが、誰の勤務も営業時間と重ならないとき
 * だけ返す（勤務時間が 1 件も無い店舗には、別の案内＝「勤務時間を保存したスタッフ」が出る）。
 * 注意は保存の結果を変えないので、読めなければ何も返さない（保存を失敗にしない）。
 */
export async function hoursSaveStaffWarning(client: SupabaseClient, facilityId: string): Promise<string | null> {
  try {
    const staff = await readWorkingStaff(client, facilityId);
    return staff.workingIds.size === 0 && staff.outsideHoursIds.size > 0 ? NO_STAFF_INSIDE_HOURS_WARNING : null;
  } catch {
    return null;
  }
}

/** 施設の営業時間。読めなければ例外（呼び出し側の try で「注意なし」に倒す）。 */
async function readBusinessHours(client: SupabaseClient, facilityId: string): Promise<unknown> {
  const { data, error } = await client.from('facility_profiles').select('business_hours').eq('id', facilityId).maybeSingle();
  if (error || !data) throw new Error('business hours unavailable');
  return (data as { business_hours?: unknown }).business_hours ?? null;
}

/** 週間の勤務を保存した後の注意（保存の結果は変えないので、読めなければ何も返さない）。 */
export async function weeklyScheduleSaveWarning(client: SupabaseClient, facilityId: string, schedules: readonly WeeklyWindow[]): Promise<string | null> {
  try {
    return weeklyScheduleHoursWarning(await readBusinessHours(client, facilityId), schedules);
  } catch {
    return null;
  }
}

/** 勤務する特別日を保存した後の注意（同上）。 */
export async function specialDaySaveWarning(client: SupabaseClient, facilityId: string, date: string, start: string, end: string): Promise<string | null> {
  try {
    return specialDayHoursWarning(await readBusinessHours(client, facilityId), date, start, end);
  } catch {
    return null;
  }
}
