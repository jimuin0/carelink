/**
 * 日次売上集計 Cron（v8.1）
 * GET /api/cron/daily-summary
 * 毎日深夜に前日の予約データをdaily_revenue_summaryに集計
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logCronRun } from '@/lib/cron-logger';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  // CRON_SECRET認証
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = new Date();
  try {
    // 前日の日付（JST）
    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() + 9); // UTC→JST
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    // 全施設取得
    const { data: facilities } = await supabase
      .from('facility_profiles')
      .select('id')
      .eq('status', 'published');

    if (!facilities) return NextResponse.json({ status: 'ok', count: 0 });

    let count = 0;

    for (const facility of facilities) {
      // 前日の予約データ集計
      const { data: bookings } = await supabase
        .from('bookings')
        .select('status, total_price, email')
        .eq('facility_id', facility.id)
        .eq('booking_date', dateStr);

      if (!bookings || bookings.length === 0) continue;

      const completed = bookings.filter(b => b.status === 'completed');
      const cancelled = bookings.filter(b => b.status === 'cancelled');
      const noShow = bookings.filter(b => b.status === 'no_show');

      // 新規/リピート判定（過去に予約があるかで判定）
      const emails = Array.from(new Set(bookings.map(b => b.email).filter(Boolean)));
      let newCount = 0;
      let repeatCount = 0;

      for (const email of emails) {
        const { count: pastCount } = await supabase
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .eq('facility_id', facility.id)
          .eq('email', email)
          .lt('booking_date', dateStr);

        if ((pastCount ?? 0) > 0) {
          repeatCount++;
        } else {
          newCount++;
        }
      }

      const totalRevenue = completed.reduce((sum, b) => sum + (b.total_price || 0), 0);

      await supabase
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

      count++;
    }

    await logCronRun('daily-summary', 'success', startedAt, { processed: count, meta: { date: dateStr } });
    return NextResponse.json({ status: 'ok', date: dateStr, facilities: count });
  } catch (e) {
    console.error('[daily-summary] Error:', e);
    await logCronRun('daily-summary', 'error', startedAt, { error_msg: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
