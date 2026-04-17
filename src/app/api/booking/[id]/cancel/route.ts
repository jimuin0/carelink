import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { sendBookingCancelled } from '@/lib/email';
import * as Sentry from '@sentry/nextjs';
import { sendBookingCancellation as sendLineCancellation } from '@/lib/line';
import { createClient } from '@supabase/supabase-js';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { writeAuditLog } from '@/lib/audit-logger';
import { notifyCancellationLineWorks, isLineWorksConfigured } from '@/lib/integrations/line-works';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
  const csrfError = checkCsrf(_request);
  if (csrfError) return csrfError;

  const ip = _request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (await checkRateLimit(mutationRateLimit, ip, 10, 60_000, 'cancel')) {
    return NextResponse.json({ error: '短時間に多くのリクエストがありました。しばらくお待ちください。' }, { status: 429 });
  }

  if (!uuidRegex.test(params.id)) {
    return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 });
  }
  const cookieStore = cookies();
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

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, user_id, status, facility_id, customer_name, email, booking_date, start_time, end_time, total_price, menu_id, staff_id')
    .eq('id', params.id)
    .single();

  if (!booking) return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
  if (booking.user_id !== user.id) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  if (booking.status === 'cancelled') return NextResponse.json({ error: '既にキャンセル済みです' }, { status: 400 });

  const { error } = await supabase
    .from('bookings')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json({ error: 'キャンセルに失敗しました' }, { status: 500 });
  }

  // 監査ログ（非ブロッキング）
  void writeAuditLog({
    userId: user.id,
    facilityId: booking.facility_id,
    action: 'cancel',
    tableName: 'bookings',
    recordId: booking.id,
    oldValues: { status: booking.status },
    newValues: { status: 'cancelled' },
    ipAddress: _request.headers.get('x-forwarded-for')?.split(',')[0] ?? null,
  });

  // Send cancellation email (non-blocking)
  try {
    const { data: facility } = await supabase.from('facility_profiles').select('name').eq('id', booking.facility_id).single();
    let menuName: string | undefined;
    if (booking.menu_id) {
      const { data: menu } = await supabase.from('facility_menus').select('name').eq('id', booking.menu_id).single();
      menuName = menu?.name;
    }
    const emailData = {
      customerName: booking.customer_name,
      customerEmail: booking.email,
      facilityName: facility?.name || '',
      bookingDate: booking.booking_date,
      startTime: booking.start_time,
      endTime: booking.end_time,
      menuName,
      totalPrice: booking.total_price ?? undefined,
      bookingId: booking.id,
    };
    void sendBookingCancelled(emailData);

    // サロンオーナーにキャンセル通知
    const { data: owner } = await supabase
      .from('facility_members')
      .select('user_id')
      .eq('facility_id', booking.facility_id)
      .eq('role', 'owner')
      .limit(1)
      .single();
    if (owner) {
      const { data: ownerProfile } = await supabase.from('profiles').select('email').eq('id', owner.user_id).single();
      if (ownerProfile?.email) {
        void sendBookingCancelled({ ...emailData, customerEmail: ownerProfile.email });
      }
    }
  } catch {}

  // LINE cancellation notification (non-blocking)
  try {
    if (user && process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK) {
      const adminSupabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
      const { data: lineLink } = await adminSupabase
        .from('line_user_links')
        .select('line_user_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (lineLink?.line_user_id) {
        const { data: facilityForLine } = await supabase
          .from('facility_profiles')
          .select('name')
          .eq('id', booking.facility_id)
          .maybeSingle();

        let cancelMenuName = '';
        if (booking.menu_id) {
          const { data: menuForLine } = await supabase.from('facility_menus').select('name').eq('id', booking.menu_id).maybeSingle();
          cancelMenuName = menuForLine?.name || '';
        }

        void sendLineCancellation(lineLink.line_user_id, {
          facilityName: facilityForLine?.name || '',
          menuName: cancelMenuName,
          date: booking.booking_date,
          time: booking.start_time,
        });
      }
    }
  } catch {}

  // LINE Works cancellation notification (non-blocking)
  if (isLineWorksConfigured()) {
    try {
      const adminSupabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
      const { data: staffList } = await adminSupabase
        .from('staff_profiles')
        .select('line_works_channel_id, line_works_notify_all, id')
        .eq('facility_id', booking.facility_id)
        .not('line_works_channel_id', 'is', null);

      if (staffList && staffList.length > 0) {
        let cancelMenuName = '';
        if (booking.menu_id) {
          const { data: menuForLW } = await adminSupabase.from('facility_menus').select('name').eq('id', booking.menu_id).maybeSingle();
          cancelMenuName = menuForLW?.name || '';
        }
        const cancelInfo = {
          customerName: booking.customer_name,
          menuName: cancelMenuName,
          bookingDate: booking.booking_date,
          startTime: booking.start_time,
        };
        for (const staff of staffList) {
          if (!staff.line_works_channel_id) continue;
          const isAssigned = staff.id === booking.staff_id;
          if (isAssigned || staff.line_works_notify_all) {
            notifyCancellationLineWorks(staff.line_works_channel_id, cancelInfo).catch((e) =>
              Sentry.captureException(e, { tags: { feature: 'cancel-lineworks' } })
            );
          }
        }
      }
    } catch (e) {
      Sentry.captureException(e, { tags: { feature: 'cancel-lineworks-setup' } });
    }
  }

  return NextResponse.json({ success: true });
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'booking-cancel' } });
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
