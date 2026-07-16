import { createServerSupabaseClient } from './supabase-server';
import type { Coupon, CouponMenu } from '@/types';

// オーナー管理画面(admin/coupons/page.tsx)向け＝is_active な全クーポンを返す（期間フィルタ
// なし）。この画面は期間外（未来開始／期限切れ）のクーポンも一覧・編集リンク・利用実績の
// 到達導線を出す必要があるため、valid_from/valid_until での絞り込みをしてはならない。
// 顧客向けの表示は getActiveCouponsByFacility を使うこと（下記）。
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

// 顧客向け(facility/[slug]/page.tsx・facility/[slug]/booking/page.tsx)＝いま利用可能な
// クーポンのみを返す。
// 【恒久根治】is_active=true のみでは期間外（valid_from 未到来／valid_until 経過済み）の
// クーポンも表示され、客が選択すると api/booking のサーバー検証(同じ valid_from/valid_until
// 判定)で 400 になる（表示と予約可否の不整合）。api/liff/coupons と同じ
// valid_from<=now<=valid_until フィルタをDB側でも適用し、表示自体を期間内のみに揃える。
// オーナー管理画面はこの関数を使ってはならない（期間外クーポンが消え編集導線が失われる）。
export async function getActiveCouponsByFacility(facilityId: string): Promise<Coupon[]> {
  const supabase = createServerSupabaseClient();
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
