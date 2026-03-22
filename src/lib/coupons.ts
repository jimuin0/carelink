import { createServerSupabaseClient } from './supabase-server';
import type { Coupon, CouponMenu } from '@/types';

export async function getCouponsByFacility(facilityId: string): Promise<Coupon[]> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('coupons')
    .select('*')
    .eq('facility_id', facilityId)
    .eq('is_active', true)
    .order('sort_order');
  return (data ?? []) as Coupon[];
}

export async function getCouponMenus(couponId: string): Promise<CouponMenu[]> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('coupon_menus')
    .select('*')
    .eq('coupon_id', couponId);
  return (data ?? []) as CouponMenu[];
}

export async function getCouponsByMenuId(menuId: string): Promise<Coupon[]> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('coupon_menus')
    .select('coupon_id, coupons(*)')
    .eq('menu_id', menuId);

  if (!data) return [];
  return data
    .map((row: Record<string, unknown>) => row.coupons as Coupon)
    .filter((c: Coupon) => c.is_active);
}

export async function hasCoupons(facilityId: string): Promise<boolean> {
  const supabase = createServerSupabaseClient();
  const { count } = await supabase
    .from('coupons')
    .select('id', { count: 'exact', head: true })
    .eq('facility_id', facilityId)
    .eq('is_active', true);
  return (count ?? 0) > 0;
}
