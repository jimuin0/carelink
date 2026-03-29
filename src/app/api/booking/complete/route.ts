import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import * as Sentry from '@sentry/nextjs';

export async function POST(request: Request) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const body = await request.json();
    const { bookingId } = body;

    if (!bookingId || !uuidRegex.test(bookingId)) {
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

    // Auth check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
    }

    // Permission check (owner or admin)
    const { data: membership } = await supabase
      .from('facility_members')
      .select('facility_id, role')
      .eq('user_id', user.id)
      .single();

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 });
    }

    // Fetch booking with facility ownership check
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, facility_id, user_id, customer_name, email, booking_date, start_time, end_time, total_price, menu_id, staff_id, status')
      .eq('id', bookingId)
      .eq('facility_id', membership.facility_id)
      .single();

    if (!booking) {
      return NextResponse.json({ error: '予約が見つかりません' }, { status: 404 });
    }

    if (booking.status !== 'confirmed') {
      return NextResponse.json({ error: 'この予約は来店完了にできません（確定済みの予約のみ対応）' }, { status: 400 });
    }

    // Update booking status to completed
    const { error: updateError } = await supabase
      .from('bookings')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', bookingId)
      .eq('facility_id', membership.facility_id);

    if (updateError) {
      return NextResponse.json({ error: 'ステータスの更新に失敗しました' }, { status: 500 });
    }

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
    await supabase.from('customer_visits').insert({
      facility_id: membership.facility_id,
      booking_id: booking.id,
      customer_email: booking.email,
      customer_name: booking.customer_name,
      visit_date: booking.booking_date,
      menu_name: menuName,
      staff_name: staffName,
      amount: booking.total_price,
    });

    // Calculate and insert points (1 point per 100 yen)
    let pointsEarned = 0;
    if (booking.user_id && booking.total_price && booking.total_price > 0) {
      pointsEarned = Math.floor(booking.total_price / 100);
      if (pointsEarned > 0) {
        await supabase.from('user_points').insert({
          user_id: booking.user_id,
          points: pointsEarned,
          reason: '来店ポイント',
          booking_id: booking.id,
        });
      }
    }

    return NextResponse.json({ success: true, points_earned: pointsEarned });
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'booking-complete' } });
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
