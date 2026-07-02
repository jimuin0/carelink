/**
 * cron 定期ジョブの単一の真実源（SSOT）。
 *
 * 旧実装はジョブ一覧が
 *   1. .github/workflows/cron.yml の matrix `job:` リスト
 *   2. cron.yml の手動 dispatch 用 `ALLOWED_JOBS`
 *   3. cron.yml の schedule → path の `case` マッピング
 *   4. src/app/admin/cron-monitor/page.tsx の `EXPECTED_JOBS` ＋ `JOB_LABELS`
 * と 4 箇所に散在し、ジョブ追加/改名時に一部だけ更新するドリフトが起き得た。
 *
 * TS 側（4）はここから導出し、YAML 側（1〜3）との整合は
 * `src/__tests__/cron-jobs-drift.test.ts` が cron.yml を実際に読んで突合し、
 * ドリフトを CI で物理的に検知する（発症前予防）。
 */

export interface CronJob {
  /** cron.yml のエンドポイント末尾（= cron_logs.job_name）。例: 'daily-summary' */
  name: string;
  /** 管理画面（cron-monitor）の表示名 */
  label: string;
}

// 並びは cron.yml の matrix 定義順に合わせる（レビュー時の目視突合を容易にするため）。
export const CRON_JOBS: CronJob[] = [
  { name: 'booking-reminder',    label: '予約リマインド' },
  { name: 'daily-summary',       label: '日次集計' },
  { name: 'customer-segment',    label: '顧客セグメント' },
  { name: 'review-request',      label: 'レビュー依頼' },
  { name: 'sync-google-ratings', label: 'Googleレーティング同期' },
  { name: 'onboarding-followup', label: 'オンボーディングフォロー' },
  { name: 'birthday-coupon',     label: '誕生日クーポン' },
  { name: 'flag-reviews',        label: 'レビューフラグ' },
  { name: 'favorites-digest',    label: 'お気に入りダイジェスト' },
  { name: 'weekly-report',       label: '週次レポート' },
  { name: 'waitlist-notify',     label: 'キャンセル待ち通知' },
  { name: 'webhook-retry',       label: 'Webhook再送' },
  { name: 'hpb-menu-scrape',     label: 'HPBメニュー取得' },
  { name: 'schema-drift-check',  label: 'スキーマドリフト監視' },
];

/** ジョブ名の配列（cron-monitor の EXPECTED_JOBS 基準リスト）。 */
export const CRON_JOB_NAMES: string[] = CRON_JOBS.map((j) => j.name);

/** ジョブ名 → 表示名（cron-monitor の JOB_LABELS）。 */
export const CRON_JOB_LABELS: Record<string, string> = Object.fromEntries(
  CRON_JOBS.map((j) => [j.name, j.label]),
);
