import { createServerSupabaseClient } from './supabase-server';
import { readWorkingStaff } from './facility-publish-gate';
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

/**
 * 予約画面で指名できるスタッフ＝在籍していて、勤務時間がある人（週間の勤務日か、今日以降に勤務する特別日）。
 * 勤務時間の無いスタッフを指名候補に出すと、選んだ途端に毎日「満枠」になり、お客様は理由が分からない。
 * 規則は予約枠・公開カードと同じ workingStaffQuery（SQL 側は public.staff_has_working_time）。
 * 勤務状況を読めなければ例外（指名候補を空や全員に偽装しない）。
 */
export async function getBookableStaffByFacility(facilityId: string): Promise<StaffProfile[]> {
  const [staff, working] = await Promise.all([
    getStaffByFacility(facilityId),
    readWorkingStaff(createServerSupabaseClient(), facilityId),
  ]);
  return staff.filter(member => working.workingIds.has(member.id));
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
