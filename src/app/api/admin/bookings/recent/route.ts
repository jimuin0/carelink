import { NextResponse } from 'next/server';
import { withRoute, serverError, type RouteContext } from '@/lib/with-route';
import { getAdminFacilityIds, resolveTargetFacilityId } from '@/lib/facility-membership';
import { NEW_BOOKING_MAX_ROWS, resolveSince, type NewBookingNotice } from '@/lib/new-booking-poll';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/admin/bookings/recent';
const headers = { 'Cache-Control': 'no-store' };

/**
 * 管理画面を開いている間の「新規予約」通知用。選択中の店舗で since 以降に作られた予約を、
 * 通知に必要な列だけ返す。店舗は所属集合で検証し、読み取りはログイン中ユーザーの
 * クライアントで行う（bookings_facility_member_read の RLS も重ねて効く）。
 */
async function recent(request: Request, ctx: RouteContext) {
  const params = new URL(request.url).searchParams;
  const facilityIds = await getAdminFacilityIds(ctx.supabase!, ctx.user!.id, ROUTE);
  if (facilityIds instanceof NextResponse) return facilityIds;
  const { facilityId, reason } = resolveTargetFacilityId(facilityIds, params.get('facility_id'));
  if (reason === 'none' || reason === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers });
  if (reason === 'ambiguous') return NextResponse.json({ error: '店舗を指定してください' }, { status: 400, headers });

  const now = new Date();
  const since = resolveSince(params.get('since'), now.getTime());
  const { data, error } = await ctx.supabase!
    .from('bookings')
    .select('id, customer_name, booking_date, start_time, created_at')
    .eq('facility_id', facilityId)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(NEW_BOOKING_MAX_ROWS + 1);
  if (error || !Array.isArray(data)) {
    return serverError('admin-bookings-recent', error ?? new Error('RECENT_BOOKINGS_UNCONFIRMED'), ROUTE, '新規予約を確認できませんでした');
  }
  // 1 件多く読んで、上限で切れたか（more）を返す。画面側は more のとき続きをすぐ読む。
  const more = data.length > NEW_BOOKING_MAX_ROWS;
  return NextResponse.json({ now: now.toISOString(), bookings: data.slice(0, NEW_BOOKING_MAX_ROWS) as NewBookingNotice[], more }, { headers });
}

export const GET = withRoute(recent, {
  csrf: false, requireAuth: true,
  rateLimit: { limiter: null, limit: 30, windowMs: 60_000, prefix: 'admin-bookings-recent' },
  sentryTag: 'admin-bookings-recent',
});
