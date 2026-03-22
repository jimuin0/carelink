import { createServerSupabaseClient } from './supabase-server';
import type { StaffProfile, StaffPhoto } from '@/types';

export async function getStaffByFacility(facilityId: string): Promise<StaffProfile[]> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('staff_profiles')
    .select('*')
    .eq('facility_id', facilityId)
    .eq('is_active', true)
    .order('sort_order');
  return (data ?? []) as StaffProfile[];
}

export async function getStaffBySlug(facilityId: string, staffSlug: string): Promise<StaffProfile | null> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('staff_profiles')
    .select('*')
    .eq('facility_id', facilityId)
    .eq('slug', staffSlug)
    .eq('is_active', true)
    .single();
  return data as StaffProfile | null;
}

export async function getStaffPhotos(staffId: string): Promise<StaffPhoto[]> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('staff_photos')
    .select('*')
    .eq('staff_id', staffId)
    .order('sort_order');
  return (data ?? []) as StaffPhoto[];
}
