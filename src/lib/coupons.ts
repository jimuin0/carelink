import { createServerSupabaseClient } from './supabase-server';
import type { Coupon, CouponMenu } from '@/types';
import { todayJst } from './admin-date';
import { createServerSupabaseAuthClient } from './supabase-server-auth';
import { databaseDiagnostic } from './database-diagnostic';

// オーナー管理画面(admin/coupons/page.tsx)向け＝施設の全クーポンを返す（有効／無効・期間を
// 問わない）。この画面は期間外（未来開始／期限切れ）のクーポンも一覧・編集リンク・利用実績の
// 到達導線を出す必要があるため、valid_from/valid_until での絞り込みをしてはならない。
// 【2026年10月22日】is_active でも絞らない。以前は .eq('is_active', true) で絞っていたため、
// 編集画面で「有効」を外して保存したクーポンが一覧から消え、編集画面へ戻る導線が無くなって
// 二度と有効に戻せなかった（利用実績も見えなくなった）。一覧では「無効」バッジ付きで出す。
// 顧客向けの表示は getActiveCouponsByFacility を使うこと（下記・無効なクーポンは出さない）。
export async function getCouponsByFacility(facilityId: string): Promise<Coupon[]> {
  const supabase = await createServerSupabaseAuthClient();
  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('facility_id', facilityId)
    .order('sort_order');
  if (error) throw databaseDiagnostic(error);
  return (data ?? []) as Coupon[];
}

// 顧客向け(facility/[slug]/page.tsx・facility/[slug]/booking/page.tsx)＝いま利用可能な
// クーポンのみを返す。
// 【恒久根治】is_active=true のみでは期間外（valid_from 未到来／valid_until 経過済み）の
// クーポンも表示され、客が選択すると api/booking のサーバー検証(同じ valid_from/valid_until
// 判定)で 400 になる（表示と予約可否の不整合）。api/liff/coupons と同じ
// DATE列はJSTの業務日で比較し、予約APIと表示の期間境界を揃える。
// オーナー管理画面はこの関数を使ってはならない（期間外クーポンが消え編集導線が失われる）。
export async function getActiveCouponsByFacility(facilityId: string): Promise<Coupon[]> {
  const supabase = createServerSupabaseClient();
  const businessDate = todayJst();
  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('facility_id', facilityId)
    .eq('is_active', true)
    .or(`valid_from.is.null,valid_from.lte.${businessDate}`)
    .or(`valid_until.is.null,valid_until.gte.${businessDate}`)
    .order('sort_order');
  if (error) throw databaseDiagnostic(error);
  return (data ?? []) as Coupon[];
}

export async function getCouponMenus(couponId: string): Promise<CouponMenu[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('coupon_menus')
    .select('*')
    .eq('coupon_id', couponId);
  if (error) throw databaseDiagnostic(error);
  return (data ?? []) as CouponMenu[];
}

/**
 * クーポンID → 対象メニューID配列（coupon_menus に行があるクーポンだけキーを持つ）。
 * 施設ページのクーポン一覧が「通常価格」を対象メニューから出すために使う（1 クエリ）。
 * 予約画面（booking/page.tsx）が getCouponMenus で組み立てるマップと同じ形。
 * coupon_menus は公開クーポンの行だけ anon に読める（coupon_menus_public_read）。
 * 取得失敗は空マップ（＝全クーポンが対象メニュー無し）に偽装せず throw する。
 */
export async function getCouponMenuMap(couponIds: string[]): Promise<Record<string, string[]>> {
  const map: Record<string, string[]> = {};
  if (couponIds.length === 0) return map;
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('coupon_menus')
    .select('coupon_id, menu_id')
    .in('coupon_id', couponIds);
  if (error) throw databaseDiagnostic(error);
  for (const row of (data ?? []) as Pick<CouponMenu, 'coupon_id' | 'menu_id'>[]) {
    (map[row.coupon_id] ??= []).push(row.menu_id);
  }
  return map;
}
