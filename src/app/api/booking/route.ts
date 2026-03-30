import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { bookingSchema } from '@/lib/validations-booking';
import { checkCsrf } from '@/lib/csrf';
import { sendBookingConfirmation, sendNewBookingNotification } from '@/lib/email';
import { bookingRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { sendPushToFacilityOwners, sendPushToUser } from '@/lib/push';
import * as Sentry from '@sentry/nextjs';

export async function POST(request: Request) {
  try {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (await checkRateLimit(bookingRateLimit, ip, 3, 300_000, 'booking')) {
    return NextResponse.json({ error: '短時間に多くのリクエストがありました。しばらくお待ちください。' }, { status: 429 });
  }

  const body = await request.json();
  const parsed = bookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
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

  // 時間バリデーション
  if (parsed.data.start_time >= parsed.data.end_time) {
    return NextResponse.json({ error: '開始時間は終了時間より前にしてください' }, { status: 400 });
  }

  // 競合チェック
  if (parsed.data.staff_id) {
    const { data: conflicts } = await supabase
      .from('bookings')
      .select('id')
      .eq('staff_id', parsed.data.staff_id)
      .eq('booking_date', parsed.data.booking_date)
      .not('status', 'in', '("cancelled","no_show")')
      .lt('start_time', parsed.data.end_time)
      .gt('end_time', parsed.data.start_time);

    if (conflicts && conflicts.length > 0) {
      return NextResponse.json({ error: 'この時間帯は既に予約が入っています' }, { status: 409 });
    }
  }

  // Server-side price calculation (do not trust client total_price)
  let serverTotalPrice: number | null = null;
  if (parsed.data.menu_id) {
    const { data: menuRow } = await supabase
      .from('facility_menus')
      .select('price')
      .eq('id', parsed.data.menu_id)
      .eq('facility_id', parsed.data.facility_id)
      .single();
    if (menuRow) {
      serverTotalPrice = menuRow.price;
      // Apply coupon discount if provided
      if (parsed.data.coupon_id) {
        const { data: coupon } = await supabase
          .from('coupons')
          .select('discount_type, discount_value')
          .eq('id', parsed.data.coupon_id)
          .eq('facility_id', parsed.data.facility_id)
          .single();
        if (coupon && serverTotalPrice != null) {
          if (coupon.discount_type === 'percentage') {
            serverTotalPrice = Math.round(serverTotalPrice * (1 - coupon.discount_value / 100));
          } else if (coupon.discount_type === 'fixed') {
            serverTotalPrice = Math.max(0, serverTotalPrice - coupon.discount_value);
          }
        }
      }
    }
  }

  // Handle points deduction
  const pointsUsed = parsed.data.points_used || 0;
  if (pointsUsed > 0 && !user) {
    return NextResponse.json({ error: 'ポイント利用には認証が必要です' }, { status: 401 });
  }
  if (pointsUsed > 0 && user) {
    const { data: pointRows } = await supabase.from('user_points').select('points').eq('user_id', user.id);
    const balance = (pointRows ?? []).reduce((sum: number, r: { points: number }) => sum + r.points, 0);
    if (balance < pointsUsed) {
      return NextResponse.json({ error: 'ポイント残高が不足しています' }, { status: 400 });
    }
  }

  // Strip non-DB fields before insert
  const { points_used: _pointsUsed, total_price: _clientPrice, ...bookingData } = parsed.data;
  void _pointsUsed; void _clientPrice; // use server-calculated price

  const { data: inserted, error } = await supabase
    .from('bookings')
    .insert({
      ...bookingData,
      total_price: serverTotalPrice,
      user_id: user?.id ?? null,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    // DB制約違反（二重予約）の場合
    if (error.code === '23505') {
      return NextResponse.json({ error: 'この時間帯は既に予約が入っています' }, { status: 409 });
    }
    return NextResponse.json({ error: '予約に失敗しました' }, { status: 500 });
  }

  const newBookingId = inserted?.id || '';

  // Deduct points atomically: insert then verify balance didn't go negative
  if (pointsUsed > 0 && user && newBookingId) {
    await supabase.from('user_points').insert({
      user_id: user.id,
      points: -pointsUsed,
      reason: `予約利用 (${newBookingId.slice(0, 8)})`,
    });
    // Re-verify balance to detect race condition
    const { data: recheck } = await supabase.from('user_points').select('points').eq('user_id', user.id);
    const newBalance = (recheck ?? []).reduce((sum: number, r: { points: number }) => sum + r.points, 0);
    if (newBalance < 0) {
      // Rollback: delete the deduction record
      await supabase.from('user_points').delete()
        .eq('user_id', user.id)
        .eq('reason', `予約利用 (${newBookingId.slice(0, 8)})`);
      // Cancel the booking
      await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', newBookingId);
      return NextResponse.json({ error: 'ポイント残高が不足しています（競合が発生しました）' }, { status: 400 });
    }
  }

  // Send email notifications (non-blocking)
  try {
    const [facilityResult, menuResult, staffResult, ownerResult] = await Promise.all([
      supabase.from('facility_profiles').select('name, phone').eq('id', parsed.data.facility_id).single(),
      parsed.data.menu_id
        ? supabase.from('facility_menus').select('name').eq('id', parsed.data.menu_id).eq('facility_id', parsed.data.facility_id).single()
        : Promise.resolve({ data: null }),
      parsed.data.staff_id
        ? supabase.from('staff_profiles').select('name').eq('id', parsed.data.staff_id).eq('facility_id', parsed.data.facility_id).single()
        : Promise.resolve({ data: null }),
      supabase.from('facility_members').select('user_id').eq('facility_id', parsed.data.facility_id).eq('role', 'owner').single(),
    ]);

    const emailData = {
      customerName: parsed.data.customer_name,
      customerEmail: parsed.data.email,
      facilityName: facilityResult.data?.name || '',
      bookingDate: parsed.data.booking_date,
      startTime: parsed.data.start_time,
      endTime: parsed.data.end_time,
      menuName: menuResult.data?.name,
      staffName: staffResult.data?.name,
      totalPrice: parsed.data.total_price ?? undefined,
      bookingId: newBookingId,
    };

    sendBookingConfirmation(emailData).catch((e) => Sentry.captureException(e, { tags: { feature: 'booking-email' } }));

    // Notify facility owner
    if (ownerResult.data) {
      const { data: ownerProfile } = await supabase.from('profiles').select('email').eq('id', ownerResult.data.user_id).single();
      if (ownerProfile?.email) {
        sendNewBookingNotification({ ...emailData, facilityEmail: ownerProfile.email }).catch((e) => Sentry.captureException(e, { tags: { feature: 'booking-email-owner' } }));
      }
    }
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'booking-email-setup' } });
  }

  // Push notifications (non-blocking)
  try {
    sendPushToFacilityOwners(parsed.data.facility_id, {
      title: '新規予約',
      body: `${parsed.data.customer_name}様から${parsed.data.booking_date} ${parsed.data.start_time}〜の予約が入りました`,
      url: '/admin/bookings',
      tag: `booking-${newBookingId}`,
    }).catch((e) => Sentry.captureException(e, { tags: { feature: 'booking-push-owner' } }));

    if (user) {
      sendPushToUser(user.id, {
        title: '予約を受け付けました',
        body: `${parsed.data.booking_date} ${parsed.data.start_time}〜のご予約を承りました`,
        url: `/mypage/bookings/${newBookingId}`,
        tag: `booking-confirm-${newBookingId}`,
      }).catch((e) => Sentry.captureException(e, { tags: { feature: 'booking-push-user' } }));
    }
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'booking-push-setup' } });
  }

  return NextResponse.json({ success: true, bookingId: newBookingId });
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'booking' } });
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
