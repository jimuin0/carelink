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
import { verifyLineAccessToken } from '@/lib/line';
import { SLOT_OCCUPYING_STATUSES } from '@/lib/booking-status';
import { alertCaughtError } from '@/lib/alert';

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

  // ★ audience(channel)検証: /v2/profile は発行元チャネルを検証しないため、
  //   oauth2/v2.1/verify で自社チャネルID一致を必須化する（他チャネル発行トークンでの
  //   line_user_id 詐称＝他人クーポン一覧の IDOR 閲覧を遮断）。fail-closed。
  const tokenCheck = await verifyLineAccessToken(accessToken);
  if (!tokenCheck.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // LINE Profile API でトークンを検証し line_user_id を取得
  const lineRes = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!lineRes.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const lineProfile = await lineRes.json() as { userId: string };

  const admin = createServiceRoleClient();

  // line_user_id から profiles の user_id を取得
  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('line_user_id', lineProfile.userId)
    .single();
  if (!profile) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  const userId = profile.id;

  const now = new Date().toISOString();

  // ユーザーが予約関係のある施設ID（占有集合＝pending/confirmed/arrived/completed）。
  // 以前は ['confirmed','completed'] で arrived（来店中）/ pending（申込中）を取りこぼし、
  // その施設のクーポンが表示されなかった。
  const { data: pastBookings } = await admin
    .from('bookings')
    .select('facility_id')
    .eq('user_id', userId)
    .in('status', SLOT_OCCUPYING_STATUSES);

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
    .or(`valid_from.is.null,valid_from.lte.${now}`)
    .or(`valid_until.is.null,valid_until.gte.${now}`)
    .order('valid_until', { ascending: true, nullsFirst: false })
    .limit(30);

  return NextResponse.json({ coupons: coupons ?? [] });
  } catch (e) {
    console.error('[liff/coupons] unexpected error:', e);
    alertCaughtError('liff-coupons', e, '/api/liff/coupons');
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
