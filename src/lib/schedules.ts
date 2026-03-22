import { createServerSupabaseClient } from './supabase-server';
import type { AvailableSlot, StaffSchedule } from '@/types';

export async function getStaffSchedules(staffId: string): Promise<StaffSchedule[]> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('staff_schedules')
    .select('*')
    .eq('staff_id', staffId)
    .order('day_of_week');
  return (data ?? []) as StaffSchedule[];
}

export async function getAvailableSlots(
  facilityId: string,
  staffId: string,
  date: string,
  durationMinutes: number
): Promise<AvailableSlot[]> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase.rpc('get_available_slots', {
    p_facility_id: facilityId,
    p_staff_id: staffId,
    p_date: date,
    p_duration_minutes: durationMinutes,
  });
  return (data ?? []) as AvailableSlot[];
}
