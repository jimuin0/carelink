import { createServerSupabaseClient, createServiceRoleClient } from './supabase-server';
import type { AvailableSlot, StaffSchedule } from '@/types';

export async function getStaffSchedules(staffId: string): Promise<StaffSchedule[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('staff_schedules')
    .select('*')
    .eq('staff_id', staffId)
    .order('day_of_week');
  // 読み取り失敗を「勤務なし」に偽装しない（点検 A94）
  if (error) throw new Error(`[schedules] getStaffSchedules failed: ${error.message}`);
  return (data ?? []) as StaffSchedule[];
}

export async function getAvailableSlots(
  facilityId: string,
  staffId: string,
  date: string,
  durationMinutes: number
): Promise<AvailableSlot[]> {
  const { data, error } = await createServiceRoleClient().rpc('get_available_slots', {
    p_facility_id: facilityId,
    p_staff_id: staffId,
    p_date: date,
    p_duration_minutes: durationMinutes,
  });
  // RPC の失敗を「空き枠0件」に偽装しない（点検 A94）
  if (error) throw new Error(`[schedules] getAvailableSlots failed: ${error.message}`);
  return (data ?? []) as AvailableSlot[];
}
