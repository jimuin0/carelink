import { createServiceRoleClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { safeCaptureException } from '@/lib/safe';
import { logCronRun } from '@/lib/cron-logger';
import { checkCronAuth } from '@/lib/cron-auth';
import { fetchAllPaged } from '@/lib/paginate';

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

    // 翌日の confirmed 予約を全件ページング取得（旧 .limit(200) は多店舗で201件目以降に
    // リマインダーが届かず無断キャンセルを招いていた・本番監査）。
    type ReminderBooking = { id: string; customer_name: string; email: string | null; booking_date: string; start_time: string; end_time: string; facility_id: string; total_price: number | null; menu_id: string | null; menu_ids: string[] | null; staff_id: string | null };
    const { rows: bookings } = await fetchAllPaged<ReminderBooking>(
      async (offset, limit) => {
        const { data, error } = await supabase
          .from('bookings')
          .select('id, customer_name, email, booking_date, start_time, end_time, facility_id, total_price, menu_id, menu_ids, staff_id')
          .eq('booking_date', tomorrowStr)
          .eq('status', 'confirmed')
          .range(offset, offset + limit - 1);
        return { data: data as ReminderBooking[] | null, error };
      },
    );

    if (bookings.length === 0) {
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

    // メニュー名・担当名を一括取得（N+1回避）。リマインダーに施術内容・担当を載せ、複数予約の判別を可能にする。
    const allMenuIdSet = new Set<string>();
    const staffIdSet = new Set<string>();
    for (const b of bookings) {
      const ids = b.menu_ids && b.menu_ids.length > 0 ? b.menu_ids : (b.menu_id ? [b.menu_id] : []);
      ids.forEach((id) => allMenuIdSet.add(id));
      if (b.staff_id) staffIdSet.add(b.staff_id);
    }
    const menuNameMap = new Map<string, string>();
    if (allMenuIdSet.size > 0) {
      const { data: menus } = await supabase.from('facility_menus').select('id, name').in('id', Array.from(allMenuIdSet));
      (menus ?? []).forEach((m: { id: string; name: string }) => menuNameMap.set(m.id, m.name));
    }
    const staffNameMap = new Map<string, string>();
    if (staffIdSet.size > 0) {
      const { data: staff } = await supabase.from('staff_profiles').select('id, name').in('id', Array.from(staffIdSet));
      (staff ?? []).forEach((s: { id: string; name: string }) => staffNameMap.set(s.id, s.name));
    }
    const menuNamesOf = (b: ReminderBooking): string => {
      const ids = b.menu_ids && b.menu_ids.length > 0 ? b.menu_ids : (b.menu_id ? [b.menu_id] : []);
      return ids.map((id) => menuNameMap.get(id)).filter(Boolean).join('、');
    };

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
        safeCaptureException(claimError, 'booking-reminder');
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
          menuName: menuNamesOf(booking) || undefined,
          staffName: booking.staff_id ? (staffNameMap.get(booking.staff_id) || undefined) : undefined,
          totalPrice: booking.total_price ?? undefined,
          bookingId: booking.id,
        });
        sent++;
      } catch (e) {
        safeCaptureException(e, 'booking-reminder');
        skipped++;
      }
    }

    await logCronRun('booking-reminder', 'success', startedAt, {
      processed: sent,
      skipped,
      meta: { total_bookings: bookings.length },
    });
    return NextResponse.json({ processed: sent, skipped, total: bookings.length });
  } catch (e) {
    safeCaptureException(e, 'booking-reminder-cron');
    await logCronRun('booking-reminder', 'error', startedAt, {
      error_msg: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
