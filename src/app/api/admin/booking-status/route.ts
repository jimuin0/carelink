import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { sendBookingConfirmed, sendBookingCancelled, sendBookingStatusUpdate } from '@/lib/email';

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validStatuses = ['confirmed', 'completed', 'cancelled', 'no_show'];

export async function POST(request: Request) {
  try {
    const csrfError = checkCsrf(request);
    if (csrfError) return csrfError;

    const body = await request.json();
    const { bookingId, status, reason } = body;

    if (!bookingId || !uuidRegex.test(bookingId)) {
      return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 });
    }
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: '不正なステータスです' }, { status: 400 });
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

    // Permission check
    const { data: membership } = await supabase
      .from('facility_members')
      .select('facility_id, role')
      .eq('user_id', user.id)
      .single();
    if (!membership) {
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

    if (booking.status === status) {
      return NextResponse.json({ error: '既にそのステータスです' }, { status: 400 });
    }

    // Update status
    const { error } = await supabase
      .from('bookings')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', bookingId)
      .eq('facility_id', membership.facility_id);

    if (error) {
      return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
    }

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
    } catch {
      // Email failure should not block status update
      console.error('Email notification failed');
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
