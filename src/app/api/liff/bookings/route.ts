/**
 * GET /api/liff/bookings?booking_id=xxx(optional)
 * LIFFページ用: ユーザーの予約を返す（LINE access tokenで認証）
 * Authorization: Bearer <LINE_access_token> ヘッダー必須
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { fetchVerifiedLiffProfile } from '@/lib/liff-profile';
import { resolveVerifiedLineOwner } from '@/lib/verified-line-owner';
import { serverError } from '@/lib/with-route';

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

  const identity = await fetchVerifiedLiffProfile(accessToken);
  if (!identity.ok) return NextResponse.json({ error: identity.status === 401 ? 'Unauthorized' : identity.error }, { status: identity.status });

  const admin = createServiceRoleClient();

  const userId = await resolveVerifiedLineOwner(admin, identity.lineUserId);
  if (!userId) return NextResponse.json({ error: 'LINE の連携を再確認してください。本人のアカウントでログインして LINE を連携してください。', code: 'LINE_LINK_REQUIRED' }, { status: 404 });

  const bookingId = req.nextUrl.searchParams.get('booking_id');
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (bookingId && !uuidRe.test(bookingId)) return NextResponse.json({ error: 'Invalid booking_id' }, { status: 400 });

  // bookings に menu_name 列は無く menu_id 経由で取得（embed）。
  // 既存の出力形（menu_name フラット）を維持するため取得後に平坦化する。
  const SELECT = 'id, booking_date, start_time, end_time, menu:facility_menus(name), status, total_price, facility_profiles(name)';
  type RawBooking = { menu?: { name: string } | { name: string }[] | null } & Record<string, unknown>;
  const flatten = (b: RawBooking) => {
    const m = Array.isArray(b.menu) ? b.menu[0] : b.menu;
    const { menu, ...rest } = b;
    void menu;
    return { ...rest, menu_name: m?.name ?? null };
  };

  // 【2026年7月10日 恒久根治】error を検査せず null/空配列にフォールバックしていたため、
  // DB障害時も「予約なし」と偽装表示していた。.maybeSingle()/error検査で真の失敗と
  // 「該当行なし」を区別し、真の失敗は500で可視化する。
  if (bookingId) {
    const { data: booking, error } = await admin
      .from('bookings')
      .select(SELECT)
      .eq('id', bookingId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      return serverError('liff-bookings-single', error, '/api/liff/bookings', 'Internal Server Error');
    }
    return NextResponse.json({ booking: booking ? flatten(booking as RawBooking) : null });
  }

  const { data: bookings, error } = await admin
    .from('bookings')
    .select(SELECT)
    .eq('user_id', userId)
    .order('booking_date', { ascending: false })
    .limit(20);

  if (error) {
    return serverError('liff-bookings-list', error, '/api/liff/bookings', 'Internal Server Error');
  }

  return NextResponse.json({ bookings: (bookings ?? []).map((b) => flatten(b as RawBooking)) });
  } catch (e) {
    return serverError('liff-bookings', e, '/api/liff/bookings', 'Internal Server Error');
  }
}
