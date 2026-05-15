import { NextResponse } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import * as Sentry from '@sentry/nextjs';
import { writeAuditLog } from '@/lib/audit-logger';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    if (await checkRateLimit(mutationRateLimit, ip, 10, 60_000, 'complete')) {
      return NextResponse.json({ error: '短時間に多くのリクエストがありました。しばらくお待ちください。' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const { bookingId } = body;

    if (!bookingId || !uuidRegex.test(bookingId)) {
      return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 });
    }

    // Auth check（セッション検証には authClient を使用）
    const authClient = await createServerSupabaseAuthClient();
    const { data: { user } } = await authClient.auth.getUser();
    // DB 操作には serviceRole を使用（RLS バイパス）
    const supabase = createServiceRoleClient();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    // Fetch booking first to know which facility to authorize against
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, facility_id, user_id, customer_name, email, booking_date, start_time, end_time, total_price, menu_id, staff_id, status')
      .eq('id', bookingId)
      .single();

    if (!booking) {
      return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
    }

    // Permission check: must be owner/admin of this booking's facility
    const { data: membership } = await supabase
      .from('facility_members')
      .select('facility_id, role')
      .eq('user_id', user.id)
      .eq('facility_id', booking.facility_id)
      .in('role', ['owner', 'admin'])
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 });
    }

    if (booking.status !== 'confirmed') {
      return NextResponse.json({ error: 'この予約は来店完了にできません（確定済みの予約のみ対応）' }, { status: 400 });
    }

    // Atomic status transition: require status='confirmed' in WHERE clause (optimistic lock).
    // Prevents double point awards if two concurrent requests both read 'confirmed'.
    const { data: updatedBooking, error: updateError } = await supabase
      .from('bookings')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', bookingId)
      .eq('facility_id', membership.facility_id)
      .eq('status', 'confirmed')
      .select('id')
      .maybeSingle();

    if (updateError) {
      return NextResponse.json({ error: 'ステータスの更新に失敗しました' }, { status: 500 });
    }
    if (!updatedBooking) {
      // Zero rows updated: status was already changed by another request
      return NextResponse.json({ error: 'この予約は来店完了にできません（既に処理済みの可能性があります）' }, { status: 409 });
    }

    void writeAuditLog({
      userId: user.id,
      facilityId: booking.facility_id,
      action: 'confirm',
      tableName: 'bookings',
      recordId: bookingId,
      oldValues: { status: 'confirmed' },
      newValues: { status: 'completed' },
      ipAddress: ip,
    });

    // Fetch menu name and staff name for customer_visits
    let menuName: string | null = null;
    let staffName: string | null = null;

    if (booking.menu_id) {
      const { data: menu } = await supabase.from('facility_menus').select('name').eq('id', booking.menu_id).single();
      menuName = menu?.name || null;
    }
    if (booking.staff_id) {
      const { data: staff } = await supabase.from('staff_profiles').select('name').eq('id', booking.staff_id).single();
      staffName = staff?.name || null;
    }

    // Insert customer visit record
    const { error: visitError } = await supabase.from('customer_visits').insert({
      facility_id: membership.facility_id,
      booking_id: booking.id,
      customer_email: booking.email,
      customer_name: booking.customer_name,
      visit_date: booking.booking_date,
      menu_name: menuName,
      staff_name: staffName,
      amount: booking.total_price,
    });
    if (visitError) {
      Sentry.captureException(visitError, { tags: { feature: 'booking-complete', step: 'visit-insert' } });
    }

    // Calculate and insert points (1 point per 100 yen)
    let pointsEarned = 0;
    if (booking.user_id && booking.total_price && booking.total_price > 0) {
      pointsEarned = Math.floor(booking.total_price / 100);
      if (pointsEarned > 0) {
        // user_points has no INSERT policy for authenticated clients; use service_role
        const serviceSupabase = createServiceRoleClient();
        const { error: pointError } = await serviceSupabase.from('user_points').insert({
          user_id: booking.user_id,
          points: pointsEarned,
          reason: '来店ポイント',
          booking_id: booking.id,
        });
        if (pointError) {
          Sentry.captureException(pointError, { tags: { feature: 'booking-complete', step: 'point-insert' } });
        }
      }
    }

    return NextResponse.json({ success: true, points_earned: pointsEarned });
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'booking-complete' } });
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
