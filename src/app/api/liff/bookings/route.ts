/**
 * GET /api/liff/bookings?booking_id=xxx(optional)
 * LIFFページ用: ユーザーの予約を返す（LINE access tokenで認証）
 * Authorization: Bearer <LINE_access_token> ヘッダー必須
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { verifyLineAccessToken } from '@/lib/line';

export async function GET(req: NextRequest) {
  try {
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 30, 60_000, 'liff-bookings')) {
    return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
  }

  // LINE access tokenでユーザーを認証
  const authHeader = req.headers.get('Authorization');
  const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ★ audience(channel)検証: /v2/profile は発行元チャネル(client_id)を検証しないため、
  //   oauth2/v2.1/verify で自社チャネルID一致を必須化する（他チャネル発行トークンでの
  //   line_user_id 詐称＝他人予約のIDOR閲覧を遮断）。fail-closed。
  const tokenCheck = await verifyLineAccessToken(accessToken);
  if (!tokenCheck.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // LINE Profile APIでトークンを検証
  const lineRes = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!lineRes.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const lineProfile = await lineRes.json() as { userId: string };

  const admin = createServiceRoleClient();

  // line_user_idからprofilesのuser_idを取得
  const { data: profile } = await admin
    .from('profiles')
    .select('id')
    .eq('line_user_id', lineProfile.userId)
    .single();
  if (!profile) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  const userId = profile.id;

  const bookingId = req.nextUrl.searchParams.get('booking_id');
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (bookingId && !uuidRe.test(bookingId)) return NextResponse.json({ error: 'Invalid booking_id' }, { status: 400 });

  if (bookingId) {
    const { data: booking } = await admin
      .from('bookings')
      .select('id, booking_date, start_time, end_time, menu_name, status, total_price, facility_profiles(name)')
      .eq('id', bookingId)
      .eq('user_id', userId)
      .single();
    return NextResponse.json({ booking: booking ?? null });
  }

  const { data: bookings } = await admin
    .from('bookings')
    .select('id, booking_date, start_time, end_time, menu_name, status, total_price, facility_profiles(name)')
    .eq('user_id', userId)
    .order('booking_date', { ascending: false })
    .limit(20);

  return NextResponse.json({ bookings: bookings ?? [] });
  } catch (e) {
    console.error('[liff/bookings] unexpected error:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
