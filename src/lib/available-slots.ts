import type { SupabaseClient } from '@supabase/supabase-js';
import type { AvailableSlot } from '@/types';
import { todayJst } from '@/lib/admin-date';

/**
 * /api/slots（1スタッフ×1日）と /api/slots/week（複数スタッフ×最大7日）が共有する空き枠取得。
 * 両方が同じ RPC・同じ「当日の開始済み枠を除く」規則を使うよう、ここにだけ置く。
 */

export const SLOT_DURATION_DEFAULT = 60;

export function clampDuration(raw: string | null): number {
  const n = parseInt(raw || String(SLOT_DURATION_DEFAULT), 10);
  return Number.isNaN(n) ? SLOT_DURATION_DEFAULT : Math.min(Math.max(n, 15), 480);
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

/** get_available_slots は anon から実行できない SECURITY DEFINER。service role の呼び出し元だけが使う。 */
export async function readSlots(
  admin: SupabaseClient, facilityId: string, staffId: string, date: string, duration: number,
): Promise<SlotRead> {
  const { data, error } = await admin.rpc('get_available_slots', {
    p_facility_id: facilityId, p_staff_id: staffId, p_date: date, p_duration_minutes: duration,
  });
  if (error) return { slots: null, error };
  return { slots: dropStartedSlotsToday(date, (data ?? []) as AvailableSlot[]), error: null };
}
