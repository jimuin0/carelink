import { createServerSupabaseClient } from './supabase-server';
import type { StaffProfile, StaffPhoto, MenuStaff } from '@/types';

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

/**
 * 指定メニュー群のメニュー担当スタッフ(menu_staff)行を取得する（2026年7月15日 HPB準拠仕様導入）。
 * menu_staff は facility_id 列を持たないため、呼び出し側で facility_menus に属することが
 * 検証済みの menuIds（例：getFacilityMenus の結果）を渡す想定。menuIds が空なら問い合わせ自体を
 * 行わず空配列を返す（無駄な全件スキャンを避ける）。
 */
export async function getMenuStaffByMenuIds(menuIds: string[]): Promise<MenuStaff[]> {
  if (menuIds.length === 0) return [];
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('menu_staff')
    .select('*')
    .in('menu_id', menuIds);
  return (data ?? []) as MenuStaff[];
}
