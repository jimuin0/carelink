import { createServerSupabaseClient } from './supabase-server';
import type { Coupon, CouponMenu } from '@/types';

export async function getCouponsByFacility(facilityId: string): Promise<Coupon[]> {
  const supabase = createServerSupabaseClient();
  // 【恒久根治】is_active=true のみでは期間外（valid_from 未到来／valid_until 経過済み）の
  // クーポンも表示され、客が選択すると api/booking のサーバー検証(同じ valid_from/valid_until
  // 判定)で 400 になる（表示と予約可否の不整合）。api/liff/coupons と同じ
  // valid_from<=now<=valid_until フィルタをDB側でも適用し、表示自体を期間内のみに揃える。
  const now = new Date().toISOString();
  const { data } = await supabase
    .from('coupons')
    .select('*')
    .eq('facility_id', facilityId)
    .eq('is_active', true)
    .or(`valid_from.is.null,valid_from.lte.${now}`)
    .or(`valid_until.is.null,valid_until.gte.${now}`)
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
    .flatMap((row: Record<string, unknown>) => {
      const c = row.coupons;
      if (!c) return [];
      // Supabase may return a single object or an array for joined relations
      return Array.isArray(c) ? (c as Coupon[]) : [c as Coupon];
    })
    .filter((c: Coupon) => c?.is_active);
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
