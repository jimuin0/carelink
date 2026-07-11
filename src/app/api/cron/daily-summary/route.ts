/**
 * 日次売上集計 Cron（v8.1）
 * GET /api/cron/daily-summary
 * 毎日深夜に前日の予約データをdaily_revenue_summaryに集計
 */

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { logCronRun } from '@/lib/cron-logger';
import { checkCronAuth } from '@/lib/cron-auth';
import { alertDeliveryFailures } from '@/lib/alert';
import { todayJst, addDays } from '@/lib/admin-date';
import { sendDailySummaryEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
// 1クエリの集合集計なので低い既定上限でも足りるが、念のため明示。
export const maxDuration = 60;

/**
 * email_daily_summary を ON にした施設にのみ、前日の売上サマリーをメール送信する。
 * 既定（行なし）は OFF（email_daily_summary DEFAULT false）なので、明示的に ON の施設だけ送る。
 * 送信失敗・1施設の取得失敗は他施設の送信を止めない（best-effort）。
 * 送信成功件数(sent)と送達失敗件数(failed)を返す（failed は run 単位で集約 Slack 通報される）。
 */
async function sendDailySummaryEmails(
  supabase: ReturnType<typeof createServiceRoleClient>,
  dateStr: string,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const { data: optedIn, error: optedInErr } = await supabase
    .from('facility_notification_settings')
    .select('facility_id')
    .eq('email_daily_summary', true);
  // error を握り潰すと optedIn=null → 「ON 施設なし」と区別できず無音でメール送信全体が
  // skip される（設定 ON なのに届かない silent miss）。error を可視化して原因を追える様にする。
  if (optedInErr) {
    console.error('[daily-summary] facility_notification_settings fetch failed', { err: optedInErr });
    return { sent: 0, failed: 0, skipped: 0 };
  }
  if (!optedIn || optedIn.length === 0) return { sent: 0, failed: 0, skipped: 0 };
  const facilityIds = (optedIn as { facility_id: string }[]).map((r) => r.facility_id);

  const { data: summaries, error: summariesErr } = await supabase
    .from('daily_revenue_summary')
    .select('facility_id, total_revenue, booking_count, completed_count, cancelled_count, new_customer_count, repeat_customer_count')
    .eq('date', dateStr)
    .in('facility_id', facilityIds);
  // 同上：daily_revenue_summary の取得失敗を「サマリ 0 件」と区別できず無音 skip するのを防ぐ。
  if (summariesErr) {
    console.error('[daily-summary] daily_revenue_summary fetch failed', { err: summariesErr, date: dateStr });
    return { sent: 0, failed: 0, skipped: 0 };
  }
  if (!summaries || summaries.length === 0) return { sent: 0, failed: 0, skipped: 0 };

  // 監査P2: 従来は施設ごとにfacility_members→profiles→facility_profilesの3クエリを
  // ループ内で直列発行していた(O(N))。施設数増加でVercel関数のmaxDuration(60s)を超えて
  // timeoutし、未処理施設のメールが恒久欠落するリスクがあった。前段でバルク一括取得し
  // ループ内はマップ参照のみにする(クエリ数はO(1)、件数に依存しない)。
  const summaryFacilityIds = [...new Set((summaries as Array<{ facility_id: string }>).map((s) => s.facility_id))];

  const { data: owners } = await supabase
    .from('facility_members').select('facility_id, user_id')
    .in('facility_id', summaryFacilityIds).eq('role', 'owner');
  const ownerByFacility = new Map<string, string>();
  for (const o of (owners ?? []) as Array<{ facility_id: string; user_id: string }>) {
    if (!ownerByFacility.has(o.facility_id)) ownerByFacility.set(o.facility_id, o.user_id);
  }

  const ownerUserIds = [...new Set(ownerByFacility.values())];
  const { data: profs } = ownerUserIds.length
    ? await supabase.from('profiles').select('id, email').in('id', ownerUserIds)
    : { data: [] as Array<{ id: string; email: string | null }> };
  const emailByUserId = new Map((profs ?? []).map((p) => [p.id as string, p.email as string | null]));

  const { data: facs } = await supabase
    .from('facility_profiles').select('id, name').in('id', summaryFacilityIds);
  const nameByFacility = new Map((facs ?? []).map((f) => [f.id as string, f.name as string | null]));

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const s of summaries as Array<Record<string, number | string | null>>) {
    const facilityId = s.facility_id as string;
    const ownerUserId = ownerByFacility.get(facilityId);
    if (!ownerUserId) { skipped++; continue; }
    const email = emailByUserId.get(ownerUserId);
    if (!email) { skipped++; continue; }
    const facilityName = nameByFacility.get(facilityId);

    // M-1: 送信前に (job, facility, 日付) を claim して二重送信を防ぐ。GitHub Actions cron.yml と
    // Render cron が同一エンドポイントを二重発火する構成のため、UNIQUE 制約で2本目の INSERT を
    // 23505 で弾き、その run は送信せずスキップする（GitHub が最大176分遅れて発火しても period_key
    // が同一日付なので再送しない）。claim 取得に失敗（23505 含む）したら送信しない。
    const { error: claimErr } = await supabase
      .from('cron_report_sends')
      .insert({ job: 'daily-summary', facility_id: facilityId, period_key: dateStr });
    if (claimErr) {
      // 23505 は正常な二重発火の抑止（別 run が既に送信）。それ以外の error も二重送信を避けるため
      // 送らずスキップし、23505 以外だけ可視化する。23505 は「既に送信済み」で実害ゼロなので
      // skipped/failed どちらにもカウントしない。23505 以外は本来送るべきだったのに技術的失敗で
      // 送れなかったケースのため failed としてカウントする（従来は無音で送達失敗率が見えなかった）。
      if (claimErr.code !== '23505') {
        console.error('[daily-summary] claim insert failed', { facilityId, date: dateStr, err: claimErr });
        failed++;
      }
      continue;
    }

    const ok = await sendDailySummaryEmail({
      facilityEmail: email,
      facilityName: facilityName ?? '施設',
      date: dateStr,
      totalRevenue: (s.total_revenue as number) ?? 0,
      bookingCount: (s.booking_count as number) ?? 0,
      completedCount: (s.completed_count as number) ?? 0,
      cancelledCount: (s.cancelled_count as number) ?? 0,
      newCustomerCount: (s.new_customer_count as number) ?? 0,
      repeatCustomerCount: (s.repeat_customer_count as number) ?? 0,
    });
    if (ok) sent++;
    else {
      failed++;
      // 送信失敗時は claim を解放し、翌 run で再送できるようにする（sent_reminders 同型）。
      // 解放にも失敗すると claim が残り翌 run が 23505 で skip＝そのメールが恒久欠落するため LOUD に可視化。
      const { error: relErr } = await supabase.from('cron_report_sends').delete()
        .eq('job', 'daily-summary').eq('facility_id', facilityId).eq('period_key', dateStr);
      if (relErr) console.error('[daily-summary] claim release failed — mail may be permanently skipped', { facilityId, date: dateStr, err: relErr });
    }
  }
  return { sent, failed, skipped };
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
    let deliveryFailures = 0;
    let emailsSkipped = 0;
    try {
      const r = await sendDailySummaryEmails(supabase, dateStr);
      emailsSent = r.sent;
      deliveryFailures = r.failed;
      emailsSkipped = r.skipped;
    } catch (e) {
      console.error('[daily-summary] summary email batch failed', e);
    }

    // processed/skipped は aggregate_daily_revenue RPC（施設単位の集計）の文脈の値で、
    // 個別スキップという概念がないため常に0が正しい。メール送信側のスキップ件数
    // （オーナー不在・メールアドレス未設定）は emailsSkipped として別途可視化する
    // （従来はここが常に無音でカウントされておらず、観測不能だった）。
    await logCronRun('daily-summary', 'success', startedAt, { processed: count, skipped: 0, meta: { date: dateStr, emailsSent, emailsSkipped } });
    // 送達失敗を run 単位で集約 Slack 通知（0 件は no-op）。
    alertDeliveryFailures('daily-summary', deliveryFailures, { emailsSent });
    return NextResponse.json({ processed: count, skipped: 0, date: dateStr, emailsSent, emailsSkipped });
  } catch (e) {
    console.error('[daily-summary] Error:', e);
    await logCronRun('daily-summary', 'error', startedAt, { error_msg: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
