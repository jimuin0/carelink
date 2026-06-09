/**
 * 日次売上集計 Cron（v8.1）
 * GET /api/cron/daily-summary
 * 毎日深夜に前日の予約データをdaily_revenue_summaryに集計
 */

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { logCronRun } from '@/lib/cron-logger';
import { checkCronAuth } from '@/lib/cron-auth';
import { fetchAllPaged } from '@/lib/paginate';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // CRON_SECRET認証（timing-safe）
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  const startedAt = new Date();
  const supabase = createServiceRoleClient();
  try {
    // 前日の日付（JST）
    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() + 9); // UTC→JST
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    // 全公開施設を全件ページング取得。
    // 旧実装は無ページングの単一 select で、PostgREST の db-max-rows(既定1000) により
    // 公開施設が 1000 を超えると 1001 件目以降が当日集計から漏れていた。日次集計は
    // 過去日を再処理しないため、漏れた施設のその日の売上サマリは永久欠落（silent miss）になる。
    const { rows: facilities, error: facilitiesErr } = await fetchAllPaged<{ id: string }>(
      async (offset, limit) => {
        const { data, error } = await supabase
          .from('facility_profiles')
          .select('id')
          .eq('status', 'published')
          .order('id', { ascending: true })
          .range(offset, offset + limit - 1);
        return { data: data as { id: string }[] | null, error };
      },
    );

    // fail-safe: 施設一覧が取れない時は中止（部分集計での誤完了を避ける）。
    if (facilitiesErr) {
      console.error('[daily-summary] facilities query failed', { err: facilitiesErr });
      await logCronRun('daily-summary', 'error', startedAt, { error_msg: 'facilities query failed' });
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
    if (facilities.length === 0) {
      await logCronRun('daily-summary', 'skipped', startedAt, { processed: 0, skipped: 0 });
      return NextResponse.json({ processed: 0, skipped: 0, status: 'ok', count: 0 });
    }

    let count = 0;
    let skipped = 0;

    for (const facility of facilities) {
      try {
        // 前日の予約データ集計
        const { data: bookings } = await supabase
          .from('bookings')
          .select('status, total_price, email')
          .eq('facility_id', facility.id)
          .eq('booking_date', dateStr);

        if (!bookings || bookings.length === 0) { skipped++; continue; }

        const completed = bookings.filter(b => b.status === 'completed');
        const cancelled = bookings.filter(b => b.status === 'cancelled');
        const noShow = bookings.filter(b => b.status === 'no_show');

        // 新規/リピート判定: 1クエリで全メールの過去予約の有無を取得（N+1回避）
        const emails = Array.from(new Set(bookings.map(b => b.email).filter(Boolean)));
        let newCount = 0;
        let repeatCount = 0;

        if (emails.length > 0) {
          const { data: pastRows } = await supabase
            .from('bookings')
            .select('email')
            .eq('facility_id', facility.id)
            .in('email', emails)
            .lt('booking_date', dateStr);

          const repeatEmails = new Set((pastRows ?? []).map(b => b.email));
          newCount = emails.filter(e => !repeatEmails.has(e)).length;
          repeatCount = emails.filter(e => repeatEmails.has(e)).length;
        }

        const totalRevenue = completed.reduce((sum, b) => sum + (b.total_price || 0), 0);

        const { error: upsertErr } = await supabase
          .from('daily_revenue_summary')
          .upsert({
            facility_id: facility.id,
            date: dateStr,
            total_revenue: totalRevenue,
            booking_count: bookings.length,
            completed_count: completed.length,
            cancelled_count: cancelled.length,
            no_show_count: noShow.length,
            new_customer_count: newCount,
            repeat_customer_count: repeatCount,
          }, { onConflict: 'facility_id,date' });
        if (upsertErr) {
          console.error('[daily-summary] revenue summary upsert failed', { facilityId: facility.id, err: upsertErr });
          skipped++;
          continue;
        }

        count++;
      } catch (facilityErr) {
        console.error('[daily-summary] facility processing error', { facilityId: facility.id, err: facilityErr });
        skipped++;
      }
    }

    await logCronRun('daily-summary', 'success', startedAt, { processed: count, skipped, meta: { date: dateStr } });
    return NextResponse.json({ processed: count, skipped, date: dateStr });
  } catch (e) {
    console.error('[daily-summary] Error:', e);
    await logCronRun('daily-summary', 'error', startedAt, { error_msg: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
