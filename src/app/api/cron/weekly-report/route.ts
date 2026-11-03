/**
 * 週次レポート Cron
 * GET /api/cron/weekly-report
 * 毎週月曜（JST）に、直近に終わった月曜〜日曜（JST）の売上を施設ごとに集計し、email_weekly_report を
 * OFF にしていない施設のオーナーへメール送信する。合算の元は daily_revenue_summary だが、
 * 合算の前に期間内の 7 日を aggregate_daily_revenue RPC で集計し直す（理由は GET 内のコメント）。
 * RPC は全施設を 1 クエリで集計する集合 UPSERT なので、7 回呼んでも施設数に比例して重くならない。
 */

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { logCronRun, cronError } from '@/lib/cron-logger';
import { alertDeliveryFailures } from '@/lib/alert';
import { checkCronAuth } from '@/lib/cron-auth';
import { countReportDeliveryHolds, markReportDeliveryAccepted } from '@/lib/cron-delivery-state';
import { todayJst, addDays, previousJstWeek } from '@/lib/admin-date';
import { sendWeeklyReportEmail, type CronEmailOutcome } from '@/lib/email';
import { fetchAllPaged } from '@/lib/paginate';

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
): Promise<{ sent: number; failed: number; skipped: number; optedOut: number; uncertain: number }> {
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

  // facility_notification_settings は PostgREST の db-max-rows(既定1000) 対象のテーブルセレクトの
  // ため、施設数が1000件を超えると単純な .select() では後半の opt-out 行が無音で取りこぼされ、
  // 明示的に OFF にした施設にも週次レポートを送ってしまう（fail-open な誤送信）。fetchAllPaged で
  // 全件取得し、failOnTruncation で「全件取得できなかった」ことをそのまま error 扱いにする
  // （下の fail-closed 方針＝取得を確定できない時は run を中止、と一貫させる）。
  const { rows: optedOut, error: optedOutErr } = await fetchAllPaged<{ facility_id: string }>(
    async (offset, limit) => {
      const res = await supabase
        .from('facility_notification_settings')
        .select('facility_id')
        .eq('email_weekly_report', false)
        .order('facility_id')
        .range(offset, offset + limit - 1);
      return { data: res.data, error: res.error };
    },
    { failOnTruncation: true },
  );
  // opt-out 一覧の取得に失敗した場合、error を握り潰すと optedOut=[] → optedOutSet が空になり、
  // email_weekly_report=false（明示 OFF）の施設にも週次レポートを送ってしまう（fail-open な誤送信）。
  // 送信対象は opt-out 方式で「設定行が無い＝送る」ため、opt-out 集合が欠けると影響が全体に及ぶ。
  // fail-closed 化：opt-out を確定できない時はこの run の送信を中止し、error として可視化する。
  if (optedOutErr) {
    // fetchAllPaged が返す error は Supabase のクエリエラー（必ず message を持つ）か、
    // failOnTruncation で生成した Error（同じく必ず message を持つ）のいずれかのみ。
    // 到達しないフォールバックは書かない（bulk-coupon/route.ts と同方針）。
    throw new Error(`facility_notification_settings fetch failed: ${(optedOutErr as { message: string }).message}`);
  }
  const optedOutSet = new Set(optedOut.map((r) => r.facility_id));

  // 監査P2: 従来は施設ごとにfacility_members→profiles→facility_profilesの3クエリを
  // ループ内で直列発行していた(O(N))。施設数増加でVercel関数のmaxDuration(60s)を超えて
  // timeoutし、未処理施設のメールが恒久欠落するリスクがあった。前段でバルク一括取得し
  // ページ単位で一括取得し、ループ内はマップ参照にする。取得障害・上限到達では送信前に停止する。
  const targetFacilityIds = [...byFacility.keys()].filter((id) => !optedOutSet.has(id));
  // 全施設が明示的に OFF の場合、空の in.() フィルタで宛先を検索しない。
  // 送信対象が無い run は正常終了し、opt-out 件数だけを記録する。
  if (targetFacilityIds.length === 0) {
    return { sent: 0, failed: 0, skipped: 0, optedOut: byFacility.size, uncertain: 0 };
  }

  const { rows: owners, error: ownersError } = await fetchAllPaged<{ facility_id: string; user_id: string }>(
    async (offset, limit) => {
      const result = await supabase.from('facility_members').select('facility_id, user_id')
        .in('facility_id', targetFacilityIds).eq('role', 'owner')
        .order('facility_id').order('user_id').range(offset, offset + limit - 1);
      return { data: result.data, error: result.error };
    },
    { failOnTruncation: true },
  );
  if (ownersError) throw ownersError;
  const ownerByFacility = new Map<string, string>();
  for (const o of owners) {
    if (!ownerByFacility.has(o.facility_id)) ownerByFacility.set(o.facility_id, o.user_id);
  }

  const ownerUserIds = [...new Set(ownerByFacility.values())];
  const { rows: profs, error: profilesError } = ownerUserIds.length
    ? await fetchAllPaged<{ id: string; email: string | null }>(
      async (offset, limit) => {
        const result = await supabase.from('profiles').select('id, email').in('id', ownerUserIds)
          .order('id').range(offset, offset + limit - 1);
        return { data: result.data, error: result.error };
      },
      { failOnTruncation: true },
    )
    : { rows: [] as Array<{ id: string; email: string | null }>, error: null };
  if (profilesError) throw profilesError;
  const emailByUserId = new Map(profs.map((p) => [p.id, p.email]));

  const { rows: facs, error: facilitiesError } = await fetchAllPaged<{ id: string; name: string | null }>(
    async (offset, limit) => {
      const result = await supabase.from('facility_profiles').select('id, name').in('id', targetFacilityIds)
        .order('id').range(offset, offset + limit - 1);
      return { data: result.data, error: result.error };
    },
    { failOnTruncation: true },
  );
  if (facilitiesError) throw facilitiesError;
  const nameByFacility = new Map(facs.map((f) => [f.id, f.name]));

  let sent = 0;
  let failed = 0;
  let uncertain = 0;
  let skipped = 0;
  let optedOutCount = 0;
  for (const [facilityId, sums] of byFacility) {
    if (optedOutSet.has(facilityId)) { optedOutCount++; continue; }
    const ownerUserId = ownerByFacility.get(facilityId);
    if (!ownerUserId) { skipped++; continue; }
    const email = emailByUserId.get(ownerUserId);
    if (!email) { skipped++; continue; }
    const facilityName = nameByFacility.get(facilityId);

    // M-1: 送信前に (job, facility, 週期間) を claim して二重送信を防ぐ。GitHub Actions cron.yml と
    // Render cron の二重発火（GitHub は最大176分遅延あり）でも、period_key が同一週なので UNIQUE
    // 制約が2本目を 23505 で弾き、その run は送信せずスキップする。
    const periodKey = `${start}..${end}`;
    const claimTime = new Date().toISOString();
    const { error: claimErr } = await supabase
      .from('cron_report_sends')
      .insert({ job: 'weekly-report', facility_id: facilityId, period_key: periodKey, sent_at: claimTime, delivery_state: 'pending' });
    if (claimErr) {
      // 23505 は正常な二重発火の抑止（別 run が既に送信済み）で実害ゼロのためカウント対象外。
      // 23505 以外は本来送るべきだったのに技術的失敗で送れなかったケースのため failed に計上する
      // （従来は無音で送達失敗率が見えなかった）。
      if (claimErr.code !== '23505') {
        console.error('[weekly-report] claim insert failed', { facilityId, period: periodKey, err: claimErr });
        failed++;
      }
      continue;
    }

    const delivery = { outcome: 'uncertain' as CronEmailOutcome };
    const ok = await sendWeeklyReportEmail({
      facilityEmail: email,
      facilityName: facilityName ?? '施設',
      periodStart: start,
      periodEnd: end,
      totalRevenue: sums.total_revenue,
      bookingCount: sums.booking_count,
      completedCount: sums.completed_count,
      cancelledCount: sums.cancelled_count,
      newCustomerCount: sums.new_customer_count,
      repeatCustomerCount: sums.repeat_customer_count,
      onOutcome: outcome => { delivery.outcome = outcome; },
    });
    if (ok) {
      if (await markReportDeliveryAccepted(supabase, 'weekly-report', facilityId, periodKey, claimTime)) sent++;
      else { failed++; uncertain++; }
    } else {
      failed++;
      // 明確な拒否だけ解放する。結果不明では自動再送を防ぐため保持する。
      // 解放にも失敗すると claim が残り翌 run が 23505 で skip＝そのメールが恒久欠落するため LOUD に可視化。
      if (delivery.outcome === 'rejected') {
        const { error: relErr } = await supabase.from('cron_report_sends').delete()
          .eq('job', 'weekly-report').eq('facility_id', facilityId).eq('period_key', periodKey).eq('sent_at', claimTime).eq('delivery_state', 'pending');
        if (relErr) console.error('[weekly-report] claim release failed — mail may be permanently skipped', { facilityId, period: periodKey, err: relErr });
      } else { uncertain++; }
    }
  }
  return { sent, failed, skipped, optedOut: optedOutCount, uncertain };
}

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  const startedAt = new Date();
  const supabase = createServiceRoleClient();
  try {
    const pendingHolds = await countReportDeliveryHolds(supabase, 'weekly-report', new Date(startedAt.getTime() - 15 * 60_000).toISOString());
    if (pendingHolds === null) return cronError('weekly-report', startedAt, new Error('REPORT_DELIVERY_HOLD_OBSERVATION_UNAVAILABLE'));
    // 集計期間＝直近に終わった月曜〜日曜（JST）。TZ非依存の純粋関数で算出。
    // 通常の月曜実行では「昨日（日曜）までの 7 日間」と同じ。実行が遅れても週がずれない。
    const { start, end } = previousJstWeek(todayJst());

    // 🔴 日曜分の欠落を防ぐ（2026年10月22日）。daily_revenue_summary は daily-summary cron
    // （毎日 JST 15:00）が「前日」1日分ずつ書き込む。週次（JST 月曜 07:10）の時点では日曜分の行が
    // まだ無いため、合算するだけだと毎週日曜の売上・予約が抜けたまま「月〜日」のレポートとして届き、
    // 翌週の期間は月曜から始まるので日曜分はどの週次にも入らなかった（日曜にしか予約が無い施設には
    // レポート自体が届かなかった）。cron の実行順序に依存しないよう、合算の前に期間内の 7 日を
    // 同じ RPC で集計し直す。RPC は ON CONFLICT で上書きする冪等な UPSERT なので、後から
    // daily-summary が同じ日を集計しても結果は変わらない。翌日 15:00 の日次集計より後に
    // 「完了」へ変えた予約も、これで週次（と日別グラフ）に反映される。
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      const { error: aggErr } = await supabase.rpc('aggregate_daily_revenue', { p_date: day });
      if (aggErr) {
        console.error('[weekly-report] aggregate_daily_revenue RPC failed', { err: aggErr, date: day });
        // 一部の日だけ古い（または欠けた）数字のレポートは送らない。claim 前に止めるので、
        // 同じ週のうちに再実行すれば（期間は previousJstWeek で同じ週になる）送り直せる。
        return cronError('weekly-report', startedAt, aggErr, { extraLog: { meta: { start, end, failedDate: day } } });
      }
    }

    const { rows, error } = await fetchAllPaged<Record<string, number | string | null>>(
      async (offset, limit) => {
        const result = await supabase.from('daily_revenue_summary')
          .select('facility_id, total_revenue, booking_count, completed_count, cancelled_count, new_customer_count, repeat_customer_count')
          .gte('date', start).lte('date', end)
          .order('facility_id').order('date').range(offset, offset + limit - 1);
        return { data: result.data, error: result.error };
      },
      { failOnTruncation: true },
    );

    if (error) {
      console.error('[weekly-report] daily_revenue_summary fetch failed', { err: error });
      return cronError('weekly-report', startedAt, error);
    }

    let emailsSent = 0;
    let deliveryFailures = 0;
    let deliveryUncertain = 0;
    let emailsSkipped = 0;
    let optedOut = 0;
    if (rows.length > 0) {
      const r = await sendWeeklyReports(supabase, rows, start, end);
      emailsSent = r.sent;
      deliveryFailures = r.failed;
      deliveryUncertain = r.uncertain;
      emailsSkipped = r.skipped;
      optedOut = r.optedOut;
    }

    // skipped は「オーナー不在・メールアドレス未設定・claim失敗」で本来送るべきだったのに
    // 送れなかった件数（従来は無音でカウントされておらず観測不能だった）。opt-out（施設が
    // 明示的にOFF）は意図的な正常動作のため skipped とは別に optedOut として可視化する。
    // 送達失敗を run 単位で集約 Slack 通知（0 件は no-op）。
    alertDeliveryFailures('weekly-report', deliveryFailures, { emailsSent });
    if (deliveryFailures > 0 || pendingHolds > 0) return cronError('weekly-report', startedAt, new Error('WEEKLY_REPORT_DELIVERY_UNCONFIRMED'), {
      extraLog: { processed: emailsSent, skipped: emailsSkipped, meta: { start, end, optedOut, deliveryFailures, deliveryUncertain, pendingHolds } },
      extraBody: { processed: emailsSent, emailsSent, emailsSkipped, optedOut, deliveryFailures, deliveryUncertain, pendingHolds },
    });
    await logCronRun('weekly-report', 'success', startedAt, { processed: emailsSent, skipped: emailsSkipped, meta: { start, end, optedOut } });
    // processed/skipped は他 cron ルート（daily-summary 等）と揃えた共通レスポンス形式。
    // emailsSent/emailsSkipped は本ルート固有の従来フィールド名（既存テストが参照するため維持）。
    return NextResponse.json({ processed: emailsSent, skipped: emailsSkipped, emailsSent, start, end, emailsSkipped, optedOut });
  } catch (e) {
    console.error('[weekly-report] Error:', e);
    return cronError('weekly-report', startedAt, e);
  }
}
