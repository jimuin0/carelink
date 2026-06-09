import { createServiceRoleClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { safeCaptureException } from '@/lib/safe';
import { logCronRun } from '@/lib/cron-logger';
import { checkCronAuth } from '@/lib/cron-auth';
import { fetchAllPaged } from '@/lib/paginate';

// Vercel Cron: runs daily at 9:00 JST (0:00 UTC)
export const dynamic = 'force-dynamic';
// 全プラン安全な明示値（Hobby 上限60s / Pro 上限300s のいずれでも有効）。
// 既定の低い値を上書きし、下の SEND_BUDGET_MS による予算ガードが確実に発火する既知の上限を与える。
export const maxDuration = 60;

// 1 回の run で「考慮」する最大予約数（メモリ上限）。到達したら警告ログを出す（silent 根絶）。
const CONSIDER_LIMIT = 5000;
// 送信ループの実時間予算。maxDuration(60s) 未満に設定し、超えたら残りを翌 run へ回す。
const SEND_BUDGET_MS = 50 * 1000;
// facility 名取得の .in() を chunk するサイズ（PostgREST の URL 長制限回避）。
const IN_CHUNK = 500;

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

    // Find confirmed bookings for tomorrow（全件取得）。
    // 旧実装は .limit(200) で、翌日の確定予約が 200 件を超えると 201 件目以降がリマインド未送信
    // のまま翌日には窓（booking_date=明日）から外れ永久に送られなかった（silent な恒久 miss）。
    // fetchAllPaged で全件・id 昇順（決定的）に取得し、送信は実時間予算ガードで打ち切る。
    type BookingRow = {
      id: string; customer_name: string | null; email: string | null;
      booking_date: string; start_time: string; end_time: string;
      facility_id: string; total_price: number | null;
    };
    const { rows: bookings, error: bookingsErr } = await fetchAllPaged<BookingRow>(
      async (offset, limit) => {
        const { data, error } = await supabase
          .from('bookings')
          .select('id, customer_name, email, booking_date, start_time, end_time, facility_id, total_price')
          .eq('booking_date', tomorrowStr)
          .eq('status', 'confirmed')
          .order('id', { ascending: true })
          .range(offset, offset + limit - 1);
        return { data: data as BookingRow[] | null, error };
      },
      { maxRows: CONSIDER_LIMIT },
    );

    // fail-safe: 予約一覧が取れない時は中止（部分処理での誤集計を避ける）。
    if (bookingsErr) {
      safeCaptureException(bookingsErr, 'booking-reminder');
      await logCronRun('booking-reminder', 'error', startedAt, { error_msg: 'bookings query failed' });
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
    if (bookings.length === 0) {
      await logCronRun('booking-reminder', 'skipped', startedAt, { processed: 0, skipped: 0 });
      return NextResponse.json({ processed: 0, skipped: 0, sent: 0 });
    }
    if (bookings.length === CONSIDER_LIMIT) {
      console.warn('[booking-reminder] consider limit reached', { limit: CONSIDER_LIMIT });
    }

    // Get facility names（.in() を chunk して URL 長制限を回避）。
    const facilityIds = Array.from(new Set(bookings.map((b) => b.facility_id)));
    const facilityMap = new Map<string, string | null>();
    for (let i = 0; i < facilityIds.length; i += IN_CHUNK) {
      const idChunk = facilityIds.slice(i, i + IN_CHUNK);
      const { data: facilities } = await supabase
        .from('facility_profiles')
        .select('id, name')
        .in('id', idChunk);
      for (const f of facilities ?? []) facilityMap.set(f.id, f.name);
    }

    // Dynamic import to avoid loading Resend unnecessarily
    const { sendBookingReminder } = await import('@/lib/email');

    let sent = 0;
    let skipped = 0;
    let deferred = 0;
    const loopStart = Date.now();
    for (let bi = 0; bi < bookings.length; bi++) {
      const booking = bookings[bi];
      // 実時間予算ガード: 残りは未処理（sent_reminders 未 claim）のまま翌 run へ。
      // 打ち切り分は logCronRun/warn で可視化する（silent 打ち切りを作らない）。
      if (Date.now() - loopStart > SEND_BUDGET_MS) {
        deferred = bookings.length - bi;
        console.warn('[booking-reminder] time budget exceeded, deferring rest to next run', { deferred });
        break;
      }
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
          customerName: booking.customer_name as string,
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
        safeCaptureException(e, 'booking-reminder');
        skipped++;
      }
    }

    await logCronRun('booking-reminder', 'success', startedAt, {
      processed: sent,
      skipped,
      meta: { total_bookings: bookings.length, deferred },
    });
    return NextResponse.json({ processed: sent, skipped, total: bookings.length, deferred });
  } catch (e) {
    safeCaptureException(e, 'booking-reminder-cron');
    await logCronRun('booking-reminder', 'error', startedAt, {
      error_msg: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
