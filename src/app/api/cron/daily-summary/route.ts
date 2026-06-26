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

export const dynamic = 'force-dynamic';
// 1クエリの集合集計なので低い既定上限でも足りるが、念のため明示。
export const maxDuration = 60;

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
    await logCronRun('daily-summary', 'success', startedAt, { processed: count, skipped: 0, meta: { date: dateStr } });
    return NextResponse.json({ processed: count, skipped: 0, date: dateStr });
  } catch (e) {
    console.error('[daily-summary] Error:', e);
    await logCronRun('daily-summary', 'error', startedAt, { error_msg: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
