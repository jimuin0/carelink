/**
 * GET /api/liff/coupons
 * LIFFページ用: ログイン中ユーザーが利用できる有効なクーポン一覧を返す
 * （お気に入り施設または過去に予約した施設のクーポン）
 *
 * 認証は他の LIFF API（points / bookings）と同一の LINE access token 方式に統一する。
 * LIFF 文脈には Supabase の cookie セッションが無く、cookie 認証だと常に 401 になり
 * クーポンが表示されない（/api/liff/auth はセッション cookie を張らずプロフィールを返すのみ）。
 * user_id はクライアント入力ではなく検証済みトークン由来の line_user_id から解決し、IDOR を防ぐ。
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { fetchVerifiedLiffProfile } from '@/lib/liff-profile';
import { resolveVerifiedLineOwner } from '@/lib/verified-line-owner';
import { SLOT_OCCUPYING_STATUSES } from '@/lib/booking-status';
import { serverError } from '@/lib/with-route';
import { todayJst } from '@/lib/admin-date';

export async function GET(req: NextRequest) {
  try {
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 30, 60_000, 'liff-coupons')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }

  // LINE access token でユーザーを認証（クライアント入力の user_id は信頼しない）。
  const authHeader = req.headers.get('Authorization');
  const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const identity = await fetchVerifiedLiffProfile(accessToken);
  if (!identity.ok) return NextResponse.json({ error: identity.status === 401 ? 'Unauthorized' : identity.error }, { status: identity.status });

  const admin = createServiceRoleClient();

  const userId = await resolveVerifiedLineOwner(admin, identity.lineUserId);
  if (!userId) return NextResponse.json({ error: 'LINE の連携を再確認してください。本人のアカウントでログインして LINE を連携してください。', code: 'LINE_LINK_REQUIRED' }, { status: 404 });

  const businessDate = todayJst();

  // ユーザーが予約関係のある施設ID（占有集合＝pending/confirmed/arrived/completed）。
  // 以前は ['confirmed','completed'] で arrived（来店中）/ pending（申込中）を取りこぼし、
  // その施設のクーポンが表示されなかった。
  // 【2026年7月10日 恒久根治】以下3クエリとも error を検査せず空配列にフォールバックしていた
  // ため、DB障害時に「対象施設なし」「クーポンなし」と偽装表示していた（実際は本人が使える
  // クーポンがあっても消えて見える）。全クエリで error を検査し、真の失敗は500で可視化する。
  const { data: pastBookings, error: pastBookingsError } = await admin
    .from('bookings')
    .select('facility_id')
    .eq('user_id', userId)
    .in('status', SLOT_OCCUPYING_STATUSES);

  if (pastBookingsError) {
    return serverError('liff-coupons-bookings', pastBookingsError, '/api/liff/coupons', 'Internal Server Error');
  }

  const facilityIds = Array.from(new Set((pastBookings ?? []).map((b) => b.facility_id)));

  // お気に入り施設IDも取得
  const { data: favorites, error: favoritesError } = await admin
    .from('favorites')
    .select('facility_id')
    .eq('user_id', userId);

  if (favoritesError) {
    return serverError('liff-coupons-favorites', favoritesError, '/api/liff/coupons', 'Internal Server Error');
  }

  const favIds = (favorites ?? []).map((f) => f.facility_id);
  const allFacilityIds = Array.from(new Set([...facilityIds, ...favIds]));

  if (allFacilityIds.length === 0) {
    return NextResponse.json({ coupons: [] });
  }

  const { data: coupons, error: couponsError } = await admin
    .from('coupons')
    .select('id, name, description, discount_type, discount_value, special_price, valid_until, coupon_type, facility_profiles(name)')
    .eq('is_active', true)
    .in('facility_id', allFacilityIds)
    .or(`valid_from.is.null,valid_from.lte.${businessDate}`)
    .or(`valid_until.is.null,valid_until.gte.${businessDate}`)
    .order('valid_until', { ascending: true, nullsFirst: false })
    .limit(30);

  if (couponsError) {
    return serverError('liff-coupons-list', couponsError, '/api/liff/coupons', 'Internal Server Error');
  }

  return NextResponse.json({ coupons: coupons ?? [] });
  } catch (e) {
    return serverError('liff-coupons', e, '/api/liff/coupons', 'Internal Server Error');
  }
}
