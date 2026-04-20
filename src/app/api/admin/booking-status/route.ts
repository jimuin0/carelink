import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { checkCsrf } from '@/lib/csrf';
import { sendBookingConfirmed, sendBookingCancelled, sendBookingStatusUpdate } from '@/lib/email';
import { sendPushToUser } from '@/lib/push';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { writeAuditLog } from '@/lib/audit-logger';

export const dynamic = 'force-dynamic';

const validStatuses = ['confirmed', 'completed', 'cancelled', 'no_show'];

// State machine: defines which transitions are permitted per current status.
// Prevents: cancelled → confirmed (re-activating cancelled bookings to extort customers)
// Prevents: completed → confirmed (which would allow re-awarding completion points)
const allowedTransitions: Record<string, string[]> = {
  pending:    ['confirmed', 'cancelled'],
  confirmed:  ['completed', 'cancelled', 'no_show'],
  completed:  ['no_show'],          // only admin correction; cannot go back to confirmed
  cancelled:  [],                   // terminal state — no transitions allowed
  no_show:    ['cancelled'],        // allow correcting a no_show to cancelled
};

export async function POST(request: Request) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    if (await checkRateLimit(mutationRateLimit, ip, 10, 60_000, 'admin-status')) {
      return NextResponse.json({ error: '短時間に多くのリクエストがありました。しばらくお待ちください。' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const { bookingId, status, reason } = body;

    if (!bookingId || !uuidRegex.test(bookingId)) {
      return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 });
    }
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: '不正なステータスです' }, { status: 400 });
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {}
          },
        },
      }
    );

    // Auth check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    // Fetch booking first to scope the permission check
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, facility_id, user_id, customer_name, email, booking_date, start_time, end_time, total_price, menu_id, staff_id, status')
      .eq('id', bookingId)
      .single();

    // Permission check: must be owner/admin of this booking's facility
    // Both "not found" and "wrong owner" return 404 to prevent booking ID enumeration
    const membership = booking
      ? await supabase
          .from('facility_members')
          .select('facility_id, role')
          .eq('user_id', user.id)
          .eq('facility_id', booking.facility_id)
          .in('role', ['owner', 'admin'])
          .maybeSingle()
          .then((r) => r.data)
      : null;

    if (!booking || !membership) {
      return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
    }

    if (booking.status === status) {
      return NextResponse.json({ error: '既にそのステータスです' }, { status: 400 });
    }

    // State machine validation: only permit defined transitions
    const permitted = allowedTransitions[booking.status] ?? [];
    if (!permitted.includes(status)) {
      return NextResponse.json(
        { error: `このステータス変更は許可されていません（${booking.status} → ${status}）` },
        { status: 400 }
      );
    }

    // Update status — include current status in WHERE clause (CAS) so concurrent updates
    // cannot bypass the state machine by updating a stale read.
    const { data: updated, error } = await supabase
      .from('bookings')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', bookingId)
      .eq('facility_id', booking.facility_id)
      .eq('status', booking.status)  // atomic guard: fail if status changed since we read it
      .select('id');

    if (error) {
      return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'ステータスが既に変更されています。ページを更新してください。' }, { status: 409 });
    }

    void writeAuditLog({
      userId: user.id,
      facilityId: booking.facility_id,
      action: 'update',
      tableName: 'bookings',
      recordId: bookingId,
      oldValues: { status: booking.status },
      newValues: { status, reason: reason ?? null },
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0] ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    });

    // Fetch facility name and menu/staff names for email
    const { data: facility } = await supabase
      .from('facility_profiles')
      .select('name')
      .eq('id', membership.facility_id)
      .single();

    let menuName: string | undefined;
    let staffName: string | undefined;

    if (booking.menu_id) {
      const { data: menu } = await supabase.from('facility_menus').select('name').eq('id', booking.menu_id).single();
      menuName = menu?.name;
    }
    if (booking.staff_id) {
      const { data: staff } = await supabase.from('staff_profiles').select('name').eq('id', booking.staff_id).single();
      staffName = staff?.name;
    }

    const emailData = {
      customerName: booking.customer_name,
      customerEmail: booking.email,
      facilityName: facility?.name || '',
      bookingDate: booking.booking_date,
      startTime: booking.start_time,
      endTime: booking.end_time,
      menuName,
      staffName,
      totalPrice: booking.total_price ?? undefined,
      bookingId: booking.id,
    };

    // Send appropriate email
    try {
      if (status === 'confirmed') {
        await sendBookingConfirmed(emailData);
      } else if (status === 'cancelled') {
        await sendBookingCancelled(emailData);
      } else {
        await sendBookingStatusUpdate({ ...emailData, newStatus: status, reason });
      }
    } catch (e) {
      Sentry.captureException(e, { tags: { feature: 'booking-email' } });
    }

    // Push notification to booking user
    if (booking.user_id) {
      const statusLabels: Record<string, string> = {
        confirmed: '予約が確定しました',
        cancelled: '予約がキャンセルされました',
        completed: '施術が完了しました',
        no_show: '来店確認が取れませんでした',
      };
      void sendPushToUser(booking.user_id, {
        title: statusLabels[status] || 'ステータス更新',
        body: `${facility?.name || ''} ${booking.booking_date} ${booking.start_time}〜`,
        url: `/mypage/bookings/${booking.id}`,
        tag: `booking-status-${booking.id}`,
      });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'admin-booking-status' } });
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
