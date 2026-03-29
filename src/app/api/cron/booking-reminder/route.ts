import { createServerSupabaseClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

// Vercel Cron: runs daily at 9:00 JST (0:00 UTC)
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServerSupabaseClient();

    // Get tomorrow's date in JST
    const tomorrow = new Date();
    tomorrow.setHours(tomorrow.getHours() + 9); // UTC to JST
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // Find confirmed bookings for tomorrow
    const { data: bookings } = await supabase
      .from('bookings')
      .select('id, customer_name, email, booking_date, start_time, end_time, facility_id, total_price')
      .eq('booking_date', tomorrowStr)
      .in('status', ['pending', 'confirmed'])
      .limit(200);

    if (!bookings || bookings.length === 0) {
      return NextResponse.json({ sent: 0 });
    }

    // Get facility names
    const facilityIds = Array.from(new Set(bookings.map((b) => b.facility_id)));
    const { data: facilities } = await supabase
      .from('facility_profiles')
      .select('id, name')
      .in('id', facilityIds);
    const facilityMap = new Map((facilities ?? []).map((f) => [f.id, f.name]));

    // Dynamic import to avoid loading Resend unnecessarily
    const { sendBookingReminder } = await import('@/lib/email');

    let sent = 0;
    for (const booking of bookings) {
      if (!booking.email) continue;
      try {
        await sendBookingReminder({
          customerName: booking.customer_name,
          customerEmail: booking.email,
          facilityName: facilityMap.get(booking.facility_id) || '',
          bookingDate: booking.booking_date,
          startTime: booking.start_time,
          endTime: booking.end_time,
          totalPrice: booking.total_price ?? undefined,
          bookingId: booking.id,
        });
        sent++;
      } catch (e) {
        Sentry.captureException(e, { tags: { feature: 'booking-reminder', bookingId: booking.id } });
      }
    }

    return NextResponse.json({ sent, total: bookings.length });
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'booking-reminder-cron' } });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
