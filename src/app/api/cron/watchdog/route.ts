/**
 * Cron 監視 watchdog（スケール監査 #5・L7-C の全 cron 化）
 * GET /api/cron/watchdog
 *
 * これまで「所定時刻を過ぎても未発火なら通知」する監視は月次 newsletter-digest 1本のみだった
 * （monthly-batch-watcher.yml）。日次・毎時の cron が失敗継続/未発火（GitHub Actions 障害等）でも
 * 誰にも能動通知されず、受動ダッシュボードを見るまで気づけなかった。
 *
 * 本 watchdog は全 cron の「最後の success からの経過時間」を cron_logs から確認し、
 * 各 cron の許容経過時間を超えていれば Slack に能動通知する（毎時実行）。
 */
import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { alertError, alertWarning } from '@/lib/alert';

export const dynamic = 'force-dynamic';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// 各 cron の「最後の success からの許容経過時間」。スケジュール周期＋余裕分で設定。
// 超過＝失敗継続 or 未発火。新しい cron を追加したらここにも登録する（監視の取りこぼし防止）。
const CRON_MAX_STALENESS_MS: Record<string, number> = {
  'booking-reminder': 26 * HOUR,    // daily
  'daily-summary': 26 * HOUR,       // daily
  'customer-segment': 8 * DAY,      // weekly
  'review-request': 26 * HOUR,      // daily
  'sync-google-ratings': 8 * DAY,   // weekly
  'onboarding-followup': 26 * HOUR, // daily
  'birthday-coupon': 26 * HOUR,     // daily
  'flag-reviews': 2 * HOUR,         // hourly
  'favorites-digest': 8 * DAY,      // weekly
  'waitlist-notify': 2 * HOUR,      // hourly
  'webhook-retry': 1 * HOUR,        // every 15 min
  'publish-scheduled-blog': 1 * HOUR, // every 15 min
  'newsletter-digest': 33 * DAY,    // monthly
};

export async function GET(request: Request) {
  const cronAuthError = checkCronAuth(request);
  if (cronAuthError) return cronAuthError;

  const startedAt = new Date();
  const supabase = createServiceRoleClient();
  const now = Date.now();

  try {
    const overdue: { job: string; lastSuccess: string | null; ageHours: number | null }[] = [];

    for (const [job, maxMs] of Object.entries(CRON_MAX_STALENESS_MS)) {
      const { data, error } = await supabase
        .from('cron_logs')
        .select('started_at')
        .eq('job_name', job)
        .eq('status', 'success')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        // cron_logs 参照自体が落ちた＝監視の盲点化。watchdog 全体を error にして能動通知する。
        alertError('cron watchdog failed to query cron_logs', { route: '/api/cron/watchdog', extra: { job, err: error.message } });
        await logCronRun('watchdog', 'error', startedAt, { error_msg: error.message });
        return NextResponse.json({ error: 'watchdog query failed' }, { status: 500 });
      }

      const last = data?.started_at ? new Date(data.started_at).getTime() : null;
      if (last === null || now - last > maxMs) {
        overdue.push({
          job,
          lastSuccess: data?.started_at ?? null,
          ageHours: last === null ? null : Math.round((now - last) / HOUR),
        });
      }
    }

    if (overdue.length > 0) {
      // 失敗継続 or 未発火の cron を能動通知（受動ダッシュボード待ちにしない）。
      alertWarning(`cron watchdog: ${overdue.length} job(s) overdue`, {
        route: '/api/cron/watchdog',
        extra: { overdue },
      });
    }

    await logCronRun('watchdog', 'success', startedAt, {
      processed: Object.keys(CRON_MAX_STALENESS_MS).length,
      skipped: overdue.length,
      meta: { overdue: overdue.map((o) => o.job) },
    });
    return NextResponse.json({ checked: Object.keys(CRON_MAX_STALENESS_MS).length, overdue });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    alertError('cron watchdog crashed', { route: '/api/cron/watchdog', extra: { error: msg } });
    await logCronRun('watchdog', 'error', startedAt, { error_msg: msg });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
