import { createServiceRoleClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { logCronRun } from '@/lib/cron-logger';
import { checkCronAuth } from '@/lib/cron-auth';

// Vercel Cron: runs daily at 9:00 JST (0:00 UTC)
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Verify cron secret (timing-safe)
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

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
      .eq('status', 'confirmed')
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
    let skipped = 0;
    for (const booking of bookings) {
      if (!booking.email) { skipped++; continue; }

      // Idempotency: claim this (booking_id, reminder_date) slot atomically.
      // If another cron invocation already inserted this row, ignoreDuplicates
      // returns no error but also inserts nothing — we detect that via re-read.
      const { error: claimError } = await supabase
        .from('sent_reminders')
        .upsert({ booking_id: booking.id, reminder_date: tomorrowStr }, {
          onConflict: 'booking_id,reminder_date',
          ignoreDuplicates: true,
        });

      if (claimError) {
        // Unexpected DB error — skip rather than risk duplicate send
        Sentry.captureException(claimError, { tags: { feature: 'booking-reminder', bookingId: booking.id } });
        skipped++;
        continue;
      }

      // Verify we won the upsert race (ignoreDuplicates means no error on conflict)
      const { data: claimed } = await supabase
        .from('sent_reminders')
        .select('sent_at')
        .eq('booking_id', booking.id)
        .eq('reminder_date', tomorrowStr)
        .single();

      // If row was inserted more than 30 seconds ago it belongs to another invocation
      if (!claimed || new Date(claimed.sent_at).getTime() < Date.now() - 30_000) {
        skipped++;
        continue;
      }

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
        skipped++;
      }
    }

    await logCronRun('booking-reminder', 'success', startedAt, {
      processed: sent,
      skipped,
      meta: { total_bookings: bookings.length },
    });
    return NextResponse.json({ sent, skipped, total: bookings.length });
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'booking-reminder-cron' } });
    await logCronRun('booking-reminder', 'error', startedAt, {
      error_msg: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
