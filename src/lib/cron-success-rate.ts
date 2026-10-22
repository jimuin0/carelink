/**
 * Cron 監視（/admin/cron-monitor）の「成功率（30日）」の計算（純粋関数・単一ソース）。
 *
 * 🔴 cron_logs.status は 'success' / 'error' / 'skipped' の 3 値で、'skipped' は
 * 「処理対象が 0 件だった＝正常終了」を表す（CLAUDE.md「cron の現状」：skipped を error と
 * 混同しないこと）。以前は success だけを分子にしていたため、webhook-retry の空キュー回・
 * booking-reminder の 9 時台以外の回・threads-backfill の対象 0 件回（30 日で全体の約 6 割）が
 * すべて失敗側に入り、全ジョブが健全でも成功率が約 42% の赤表示になっていた。
 * 赤が常態になると、本当にエラーが増えたときに気づけなくなる。
 *
 * ここでは success と skipped を「正常終了」として数え、error だけが率を下げるようにする。
 */

export interface CronRunCounts {
  /** 直近 30 日の全実行数 */
  total: number;
  /** status='success' の件数 */
  successes: number;
  /** status='skipped' の件数（処理対象 0 件＝正常） */
  skipped: number;
}

export type CronRateAccent = 'emerald' | 'amber' | 'rose' | 'gray';

/**
 * 正常終了（success + skipped）の割合を 0〜100 の整数で返す。実行記録が無いときは null（「—」表示）。
 *
 * 四捨五入ではなく切り捨てにするのは、エラーが 1 件でもあれば 100% と表示しないため
 * （例: 7,400 回中 1 件のエラーは 99.98% → 四捨五入だと 100% に見えてしまう）。
 */
export function cronHealthyRate(counts: CronRunCounts): number | null {
  if (counts.total <= 0) return null;
  const healthy = Math.min(counts.total, counts.successes + counts.skipped);
  return Math.floor((healthy / counts.total) * 100);
}

/** 成功率カードの色。記録が無いときは警告色にしない（無いものを「失敗」と見せない）。 */
export function cronHealthyRateAccent(rate: number | null): CronRateAccent {
  if (rate === null) return 'gray';
  if (rate >= 95) return 'emerald';
  if (rate >= 80) return 'amber';
  return 'rose';
}
