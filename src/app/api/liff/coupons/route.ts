/**
 * GET /api/liff/coupons
 * LIFFページ用: ログイン中ユーザーが利用できる有効なクーポン一覧を返す
 * （お気に入り施設または過去に予約した施設のクーポン）
 *
 * user_id クエリパラメータは廃止。認証セッションから取得することで
 * 他ユーザーのクーポン一覧を参照できる IDOR を防止する。
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { getTodayString } from '@/lib/validations-booking';

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 30, 60_000, 'liff-coupons')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }

  // Authenticate the caller — never trust a client-supplied user_id.
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = user.id;

  const admin = createServiceRoleClient();
  // valid_from/valid_until は DATE 列。UTCタイムスタンプ比較は当日が期限切れ判定＋JST午前ズレを起こすため
  // 日付粒度・JST の getTodayString() に統一（booking/route.ts のクーポン判定と同一基準・round2監査 #01/#06）。
  const today = getTodayString();

  // ユーザーが予約したことのある施設IDを取得
  const { data: pastBookings } = await admin
    .from('bookings')
    .select('facility_id')
    .eq('user_id', userId)
    .in('status', ['confirmed', 'completed']);

  const facilityIds = Array.from(new Set((pastBookings ?? []).map((b) => b.facility_id)));

  // お気に入り施設IDも取得
  const { data: favorites } = await admin
    .from('favorites')
    .select('facility_id')
    .eq('user_id', userId);

  const favIds = (favorites ?? []).map((f) => f.facility_id);
  const allFacilityIds = Array.from(new Set([...facilityIds, ...favIds]));

  if (allFacilityIds.length === 0) {
    return NextResponse.json({ coupons: [] });
  }

  const { data: coupons } = await admin
    .from('coupons')
    .select('id, name, description, discount_type, discount_value, special_price, valid_until, coupon_type, facility_profiles(name)')
    .eq('is_active', true)
    .in('facility_id', allFacilityIds)
    .or(`valid_from.is.null,valid_from.lte.${today}`)
    .or(`valid_until.is.null,valid_until.gte.${today}`)
    .order('valid_until', { ascending: true, nullsFirst: false })
    .limit(30);

  return NextResponse.json({ coupons: coupons ?? [] });
}
