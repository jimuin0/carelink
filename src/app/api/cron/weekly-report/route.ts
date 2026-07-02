/**
 * 週次レポート Cron
 * GET /api/cron/weekly-report
 * 毎週月曜（JST）に直近7日間の売上を施設ごとに集計し、email_weekly_report を OFF にしていない
 * 施設のオーナーへメール送信する。集計は daily-summary cron が日次で書き込む daily_revenue_summary を
 * 期間合算するため、ここでは重い再集計を行わない（timeout 回避）。
 */

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { logCronRun } from '@/lib/cron-logger';
import { checkCronAuth } from '@/lib/cron-auth';
import { todayJst, addDays } from '@/lib/admin-date';
import { sendWeeklyReportEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Sums = {
  total_revenue: number;
  booking_count: number;
  completed_count: number;
  cancelled_count: number;
  new_customer_count: number;
  repeat_customer_count: number;
};

function emptySums(): Sums {
  return { total_revenue: 0, booking_count: 0, completed_count: 0, cancelled_count: 0, new_customer_count: 0, repeat_customer_count: 0 };
}

/**
 * 期間内の daily_revenue_summary を施設ごとに合算し、email_weekly_report=false（明示 OFF）以外の
 * 施設オーナーへ週次レポートを送る。email_weekly_report は既定 true のため、設定行が無い施設も
 * 送信対象（opt-out 方式）。1施設の取得/送信失敗で他施設を止めない。送信成功件数を返す。
 */
async function sendWeeklyReports(
  supabase: ReturnType<typeof createServiceRoleClient>,
  rows: Array<Record<string, number | string | null>>,
  start: string,
  end: string,
): Promise<number> {
  const byFacility = new Map<string, Sums>();
  for (const r of rows) {
    const id = r.facility_id as string;
    const acc = byFacility.get(id) ?? emptySums();
    acc.total_revenue += (r.total_revenue as number) ?? 0;
    acc.booking_count += (r.booking_count as number) ?? 0;
    acc.completed_count += (r.completed_count as number) ?? 0;
    acc.cancelled_count += (r.cancelled_count as number) ?? 0;
    acc.new_customer_count += (r.new_customer_count as number) ?? 0;
    acc.repeat_customer_count += (r.repeat_customer_count as number) ?? 0;
    byFacility.set(id, acc);
  }

  const { data: optedOut, error: optedOutErr } = await supabase
    .from('facility_notification_settings')
    .select('facility_id')
    .eq('email_weekly_report', false);
  // opt-out 一覧の取得に失敗した場合、error を握り潰すと optedOut=null → optedOutSet が空になり、
  // email_weekly_report=false（明示 OFF）の施設にも週次レポートを送ってしまう（fail-open な誤送信）。
  // 送信対象は opt-out 方式で「設定行が無い＝送る」ため、opt-out 集合が欠けると影響が全体に及ぶ。
  // fail-closed 化：opt-out を確定できない時はこの run の送信を中止し、error として可視化する。
  if (optedOutErr) {
    throw new Error(`facility_notification_settings fetch failed: ${optedOutErr.message}`);
  }
  const optedOutSet = new Set((optedOut as { facility_id: string }[] | null ?? []).map((r) => r.facility_id));

  let sent = 0;
  for (const [facilityId, sums] of byFacility) {
    if (optedOutSet.has(facilityId)) continue;
    const { data: owner } = await supabase
      .from('facility_members').select('user_id')
      .eq('facility_id', facilityId).eq('role', 'owner').limit(1).maybeSingle();
    if (!owner) continue;
    const { data: prof } = await supabase
      .from('profiles').select('email').eq('id', (owner as { user_id: string }).user_id).maybeSingle();
    const email = (prof as { email?: string | null } | null)?.email;
    if (!email) continue;
    const { data: fac } = await supabase
      .from('facility_profiles').select('name').eq('id', facilityId).maybeSingle();
    const ok = await sendWeeklyReportEmail({
      facilityEmail: email,
      facilityName: (fac as { name?: string } | null)?.name ?? '施設',
      periodStart: start,
      periodEnd: end,
      totalRevenue: sums.total_revenue,
      bookingCount: sums.booking_count,
      completedCount: sums.completed_count,
      cancelledCount: sums.cancelled_count,
      newCustomerCount: sums.new_customer_count,
      repeatCustomerCount: sums.repeat_customer_count,
    });
    if (ok) sent++;
  }
  return sent;
}

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  const startedAt = new Date();
  const supabase = createServiceRoleClient();
  try {
    // 直近7日間（昨日まで・JST）。TZ非依存の純粋関数で算出。
    const end = addDays(todayJst(), -1);
    const start = addDays(end, -6);

    const { data: rows, error } = await supabase
      .from('daily_revenue_summary')
      .select('facility_id, total_revenue, booking_count, completed_count, cancelled_count, new_customer_count, repeat_customer_count')
      .gte('date', start)
      .lte('date', end);

    if (error) {
      console.error('[weekly-report] daily_revenue_summary fetch failed', { err: error });
      await logCronRun('weekly-report', 'error', startedAt, { error_msg: error.message });
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }

    let emailsSent = 0;
    if (rows && rows.length > 0) {
      emailsSent = await sendWeeklyReports(supabase, rows as Array<Record<string, number | string | null>>, start, end);
    }

    await logCronRun('weekly-report', 'success', startedAt, { processed: emailsSent, skipped: 0, meta: { start, end } });
    return NextResponse.json({ emailsSent, start, end });
  } catch (e) {
    console.error('[weekly-report] Error:', e);
    await logCronRun('weekly-report', 'error', startedAt, { error_msg: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
