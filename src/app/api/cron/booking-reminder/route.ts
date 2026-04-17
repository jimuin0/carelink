import { createServiceRoleClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { logCronRun } from '@/lib/cron-logger';

// Vercel Cron: runs daily at 9:00 JST (0:00 UTC)
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = new Date();
  try {
    // Use service role client to bypass RLS (cron has no auth context)
    const supabase = createServiceRoleClient();

    // Get tomorrow's date in JST (UTC+9)
    const now = new Date();
    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const tomorrow = new Date(jstNow.getTime() + 24 * 60 * 60 * 1000);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // Find confirmed bookings for tomorrow
    const { data: bookings } = await supabase
      .from('bookings')
      .select('id, customer_name, email, booking_date, start_time, end_time, facility_id, total_price')
      .eq('booking_date', tomorrowStr)
      .in('status', ['pending', 'confirmed'])
      .limit(200);

    if (!bookings || bookings.length === 0) {
      await logCronRun('booking-reminder', 'skipped', startedAt, { processed: 0, skipped: 0 });
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

    await logCronRun('booking-reminder', 'success', startedAt, {
      processed: sent,
      skipped: bookings.length - sent,
      meta: { total_bookings: bookings.length },
    });
    return NextResponse.json({ sent, total: bookings.length });
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'booking-reminder-cron' } });
    await logCronRun('booking-reminder', 'error', startedAt, {
      error_msg: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
