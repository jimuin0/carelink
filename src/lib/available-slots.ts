import type { SupabaseClient } from '@supabase/supabase-js';
import type { AvailableSlot } from '@/types';
import { todayJst } from '@/lib/admin-date';
import { clampBookingDuration, MENU_DURATION_FALLBACK_MINUTES } from '@/lib/booking-slot-rules';
import { fetchCabinetHolidays } from '@/lib/cabinet-holidays';
import type { HolidayCalendar } from '@/lib/special-business-hours';

/**
 * /api/slots（1スタッフ×1日）と /api/slots/week（複数スタッフ×最大7日）が共有する空き枠取得。
 * 両方が同じ RPC・同じ「当日の開始済み枠を除く」規則を使うよう、ここにだけ置く。
 */

export const SLOT_DURATION_DEFAULT = MENU_DURATION_FALLBACK_MINUTES;

/** クエリの所要時間を 15〜480 分に丸める（予約 API が照合する長さと同じ規則＝booking-slot-rules）。 */
export function clampDuration(raw: string | null): number {
  return clampBookingDuration(parseInt(raw || String(SLOT_DURATION_DEFAULT), 10));
}

/**
 * 当日は既に開始時刻を過ぎた枠を除く（過去時刻を予約可能に見せない＝AV-3）。
 * slot_start は "HH:MM:SS"。どこまで先を受け付けるか（リードタイム）は業務判断なので扱わない。
 */
export function dropStartedSlotsToday(date: string, slots: AvailableSlot[], nowMs = Date.now()): AvailableSlot[] {
  if (date !== todayJst()) return slots;
  const nowJst = new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(11, 19);
  return slots.filter((s) => s.slot_start > nowJst);
}

export type SlotRead = { slots: AvailableSlot[]; error: null } | { slots: null; error: unknown };

export async function loadSlotHolidayCalendar(admin: SupabaseClient, facilityId: string): Promise<{ calendar: HolidayCalendar | null; error: unknown | null }> {
  const result = await admin.from('facility_special_hours').select('close_on_public_holidays').eq('facility_id', facilityId).maybeSingle();
  if (result.error) return { calendar: null, error: result.error };
  if (!result.data?.close_on_public_holidays) return { calendar: null, error: null };
  const calendar = await fetchCabinetHolidays();
  return calendar ? { calendar, error: null } : { calendar: null, error: new Error('HOLIDAY_CALENDAR_UNAVAILABLE') };
}

/** Only called after the route verifies an excluded booking belongs to the user. */
export async function readDatedSlots(
  admin: SupabaseClient, facilityId: string, staffId: string, date: string, duration: number,
  calendar: HolidayCalendar | null, excludeBookingId?: string,
): Promise<SlotRead> {
  const { data, error } = await admin.rpc('get_available_slots_dated', {
    p_facility_id: facilityId, p_staff_id: staffId, p_date: date, p_duration_minutes: duration,
    p_exclude_booking_id: excludeBookingId ?? null,
    p_holiday_dates: calendar ? [...calendar.dates] : null, p_holiday_from: calendar?.from ?? null,
    p_holiday_through: calendar?.through ?? null,
  });
  if (error) return { slots: null, error };
  return { slots: dropStartedSlotsToday(date, (data ?? []) as AvailableSlot[]), error: null };
}

/**
 * get_available_slots は anon から実行できない SECURITY DEFINER。service role の呼び出し元だけが使う。
 *
 * excludeBookingId は日時変更画面だけが渡す（2026年10月23日）。変更しようとしている予約そのものを
 * 「埋まっている枠」に数えないため。渡さなければ従来どおり 4 引数の RPC を呼ぶ。
 * 🔴 呼び出し側は、その予約が閲覧者本人のものだと確かめてから渡すこと（他人の予約を外した空きは
 * その予約の時間を明かしてしまう）。確認は /api/slots/week が行う。
 */
export async function readSlots(
  admin: SupabaseClient, facilityId: string, staffId: string, date: string, duration: number,
  excludeBookingId?: string,
): Promise<SlotRead> {
  const { data, error } = await admin.rpc('get_available_slots', {
    p_facility_id: facilityId, p_staff_id: staffId, p_date: date, p_duration_minutes: duration,
    ...(excludeBookingId ? { p_exclude_booking_id: excludeBookingId } : {}),
  });
  if (error) return { slots: null, error };
  return { slots: dropStartedSlotsToday(date, (data ?? []) as AvailableSlot[]), error: null };
}
