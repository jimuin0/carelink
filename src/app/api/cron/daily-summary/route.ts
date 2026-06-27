/**
 * 日次売上集計 Cron（v8.1）
 * GET /api/cron/daily-summary
 * 毎日深夜に前日の予約データをdaily_revenue_summaryに集計
 */

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { logCronRun } from '@/lib/cron-logger';
import { checkCronAuth } from '@/lib/cron-auth';
import { todayJst, addDays } from '@/lib/admin-date';
import { sendDailySummaryEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
// 1クエリの集合集計なので低い既定上限でも足りるが、念のため明示。
export const maxDuration = 60;

/**
 * email_daily_summary を ON にした施設にのみ、前日の売上サマリーをメール送信する。
 * 既定（行なし）は OFF（email_daily_summary DEFAULT false）なので、明示的に ON の施設だけ送る。
 * 送信失敗・1施設の取得失敗は他施設の送信を止めない（best-effort）。送信成功件数を返す。
 */
async function sendDailySummaryEmails(
  supabase: ReturnType<typeof createServiceRoleClient>,
  dateStr: string,
): Promise<number> {
  const { data: optedIn } = await supabase
    .from('facility_notification_settings')
    .select('facility_id')
    .eq('email_daily_summary', true);
  if (!optedIn || optedIn.length === 0) return 0;
  const facilityIds = (optedIn as { facility_id: string }[]).map((r) => r.facility_id);

  const { data: summaries } = await supabase
    .from('daily_revenue_summary')
    .select('facility_id, total_revenue, booking_count, completed_count, cancelled_count, new_customer_count, repeat_customer_count')
    .eq('date', dateStr)
    .in('facility_id', facilityIds);
  if (!summaries || summaries.length === 0) return 0;

  let sent = 0;
  for (const s of summaries as Array<Record<string, number | string | null>>) {
    const facilityId = s.facility_id as string;
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
    const ok = await sendDailySummaryEmail({
      facilityEmail: email,
      facilityName: (fac as { name?: string } | null)?.name ?? '施設',
      date: dateStr,
      totalRevenue: (s.total_revenue as number) ?? 0,
      bookingCount: (s.booking_count as number) ?? 0,
      completedCount: (s.completed_count as number) ?? 0,
      cancelledCount: (s.cancelled_count as number) ?? 0,
      newCustomerCount: (s.new_customer_count as number) ?? 0,
      repeatCustomerCount: (s.repeat_customer_count as number) ?? 0,
    });
    if (ok) sent++;
  }
  return sent;
}

export async function GET(request: Request) {
  // CRON_SECRET認証（timing-safe）
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  const startedAt = new Date();
  const supabase = createServiceRoleClient();
  try {
    // 前日の日付（JST）。setHours(getHours()+9) はサーバTZ依存かつ 24超で日付が
    // 繰り上がる（実行時刻によって集計対象日がずれる）ため、TZ非依存の純粋関数で
    // 「当日JST → 1日前」を求める。
    const dateStr = addDays(todayJst(), -1);

    // 全施設を1クエリの集合集計でまとめて処理（RPC）。
    // 旧実装は公開施設を1件ずつループし各施設で bookings を複数 select していた（O(N)）。
    // 施設数が増えると Vercel 関数の実行時間を超えて timeout し、未処理施設のその日の
    // 売上サマリが永久欠落していた（前日固定・毎日1回のため繰延しても復旧不能）。
    // RPC は件数に依存せず1クエリで完了するため timeout しない（発症前の恒久根治）。
    const { data: processed, error: rpcErr } = await supabase.rpc('aggregate_daily_revenue', { p_date: dateStr });

    if (rpcErr) {
      console.error('[daily-summary] aggregate_daily_revenue RPC failed', { err: rpcErr });
      await logCronRun('daily-summary', 'error', startedAt, { error_msg: 'aggregate rpc failed' });
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }

    const count = processed ?? 0;

    // 日次売上サマリーメール（email_daily_summary=true の施設のみ・non-blocking）。
    // 旧実装は集計のみでメール送信が無く、設定トグルが効かない飾りだった。
    let emailsSent = 0;
    try {
      emailsSent = await sendDailySummaryEmails(supabase, dateStr);
    } catch (e) {
      console.error('[daily-summary] summary email batch failed', e);
    }

    await logCronRun('daily-summary', 'success', startedAt, { processed: count, skipped: 0, meta: { date: dateStr, emailsSent } });
    return NextResponse.json({ processed: count, skipped: 0, date: dateStr, emailsSent });
  } catch (e) {
    console.error('[daily-summary] Error:', e);
    await logCronRun('daily-summary', 'error', startedAt, { error_msg: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
