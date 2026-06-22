import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { sendBookingCancelled } from '@/lib/email';
import { safeCaptureException } from '@/lib/safe';
import { sendBookingCancellation as sendLineCancellation } from '@/lib/line';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { writeAuditLog } from '@/lib/audit-logger';
import { notifyCancellationLineWorks, isLineWorksConfigured } from '@/lib/integrations/line-works';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
  const csrfError = checkCsrf(_request);
  if (csrfError) return csrfError;

  const ip = getClientIp(_request);
  if (await checkRateLimit(mutationRateLimit, ip, 10, 60_000, 'cancel')) {
    return NextResponse.json({ error: '短時間に多くのリクエストがありました。しばらくお待ちください。' }, { status: 429 });
  }

  if (!uuidRegex.test(params.id)) {
    return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 });
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

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
  }

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, user_id, status, facility_id, customer_name, email, booking_date, start_time, end_time, total_price, menu_id, staff_id, points_used')
    .eq('id', params.id)
    .single();

  if (!booking) return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
  if (booking.user_id !== user.id) return NextResponse.json({ error: '権限がありません' }, { status: 403 });
  // キャンセル済み・キャンセル料支払い済み・完了済みは操作不可
  const nonCancellableStatuses = ['cancelled', 'cancel_fee_paid', 'completed', 'no_show'];
  if (nonCancellableStatuses.includes(booking.status)) {
    return NextResponse.json({ error: 'この予約はキャンセルできません' }, { status: 400 });
  }

  // CAS: 読み取った status を WHERE に含める（単一文の条件付き UPDATE＝原子的）。読み取り〜更新の間に
  // 別経路（stripe webhook の cancel_fee_paid / admin の completed 等）が状態を変えていたら 0 行と
  // なり 409 を返す。旧実装は status 条件も 0 行検査もなく、completed/cancel_fee_paid を cancelled で
  // 握り潰す競合が成立し得た（8体監査 A4#5）。
  const { data: cancelled, error } = await supabase
    .from('bookings')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('user_id', user.id)
    .eq('status', booking.status)
    .select('id');

  if (error) {
    return NextResponse.json({ error: 'キャンセルに失敗しました' }, { status: 500 });
  }
  if (!cancelled || cancelled.length === 0) {
    return NextResponse.json({ error: 'ステータスが既に変更されています。ページを更新してください。' }, { status: 409 });
  }

  // ポイント返還（金銭損失防止）。予約作成時に points_used を控除済みのため、キャンセル成立時に
  // 同額を補償行として戻す。CAS により本パスは1予約あたり1回しか到達しない（status 条件付き UPDATE が
  // 成功した時のみ）ため、二重返還は起きない。失敗は致命でないため warn のみ（要手動照合）。
  // user_points は authenticated に INSERT ポリシーが無いため service_role で挿入する。
  // booking.user_id は上の所有権チェック（!== user.id で 403）により user.id と一致＝非 null 保証。
  const refundPoints = booking.points_used ?? 0;
  if (refundPoints > 0) {
    const refundClient = createServiceRoleClient();
    const { error: refundErr } = await refundClient.from('user_points').insert({
      user_id: user.id,
      points: refundPoints,
      reason: 'キャンセル返還',
      booking_id: booking.id,
    });
    if (refundErr) {
      console.error('[cancel] point refund failed — manual cleanup needed', { bookingId: booking.id, points: refundPoints, err: refundErr.message });
    }
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
    ipAddress: getClientIp(_request),
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
  } catch (err) {
    console.error('[cancel] email notification failed:', err);
  }

  // LINE cancellation notification (non-blocking)
  try {
    if (user && process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK) {
      const adminSupabase = createServiceRoleClient();
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
  } catch (err) {
    console.error('[cancel] LINE notification failed:', err);
  }

  // LINE Works cancellation notification (non-blocking)
  if (isLineWorksConfigured()) {
    try {
      const adminSupabase = createServiceRoleClient();
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
              safeCaptureException(e, 'cancel-lineworks')
            );
          }
        }
      }
    } catch (e) {
      safeCaptureException(e, 'cancel-lineworks-setup');
    }
  }

  return NextResponse.json({ success: true });
  } catch (e) {
    safeCaptureException(e, 'booking-cancel');
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
