import { NextResponse } from 'next/server';
import { mutationRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { writeAuditLog } from '@/lib/audit-logger';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { withRoute, serverError } from '@/lib/with-route';
import { applyCompletionSideEffects } from '@/lib/booking-completion';

export const dynamic = 'force-dynamic';

export const POST = withRoute(async (request) => {
    const ip = getClientIp(request);

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

    if (booking.status !== 'confirmed' && booking.status !== 'completed') {
      return NextResponse.json({ error: 'この予約は来店完了にできません（確定済みの予約のみ対応）' }, { status: 400 });
    }

    const { data: completed, error: updateError } = await supabase.rpc('complete_booking_with_points_atomic', {
      p_actor_id: user.id, p_booking_id: bookingId, p_expected_status: 'confirmed',
    });
    if (updateError?.message.includes('BOOKING_PERMISSION_DENIED')) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
    if (updateError?.message.includes('BOOKING_REVISION_CONFLICT')) return NextResponse.json({ error: 'この予約は来店完了にできません（既に処理済みの可能性があります）' }, { status: 409 });
    if (updateError) return serverError('booking-complete-update', updateError, '/api/booking/complete', 'ステータスの更新に失敗しました');
    if (!completed || completed.length !== 1 || completed[0].id !== bookingId || !Number.isInteger(completed[0].points_earned) || completed[0].points_earned < 0 || typeof completed[0].replayed !== 'boolean') {
      return serverError('booking-complete-result', new Error('completion transaction not confirmed'), '/api/booking/complete');
    }

    if (!completed[0].replayed) void writeAuditLog({
      userId: user.id,
      facilityId: booking.facility_id,
      action: 'confirm',
      tableName: 'bookings',
      recordId: bookingId,
      oldValues: { status: 'confirmed' },
      newValues: { status: 'completed' },
      ipAddress: ip,
    });

    // 来店記録と来店ポイントはRPC内で確定済み。保存後の任意の紹介報酬を
    // 他の完了経路と同じhelperで処理し、失敗分はverified replayで再試行できる。
    await applyCompletionSideEffects(supabase, booking);
    const pointsEarned = completed[0].points_earned;

    return NextResponse.json({ success: true, points_earned: pointsEarned, replayed: completed[0].replayed });
}, {
  csrf: true,
  rateLimit: { limiter: mutationRateLimit, limit: 10, windowMs: 60_000, prefix: 'complete' },
  sentryTag: 'booking-complete',
});
