/**
 * cron 定期ジョブの単一の真実源（SSOT）。
 *
 * 旧実装はジョブ一覧が
 *   1. .github/workflows/cron.yml の workflow_dispatch options（手動実行の choice）
 *   2. cron.yml の手動 dispatch 用 `ALLOWED_JOBS`
 *   3. cron.yml の schedule → path の `case` マッピング
 *   4. src/app/admin/cron-monitor/page.tsx の `EXPECTED_JOBS` ＋ `JOB_LABELS`
 * と 4 箇所に散在し、ジョブ追加/改名/スケジュール変更時に一部だけ更新するドリフトが起き得た。
 *
 * TS 側（4）はここから導出し、YAML 側（1〜3）との整合は
 * `src/__tests__/cron-jobs-drift.test.ts` が cron.yml を実際に読んで突合し、
 * ドリフトを CI で物理的に検知する（発症前予防）。`schedule` / `intervalMinutes` は
 * cron 停止 heartbeat（src/lib/cron-heartbeat.ts）の期待実行間隔の基準にもなるため、
 * cron.yml の schedule と厳密一致していることを同テストが保証する。
 */

import cronJobsData from './cron-jobs.data.json';

export interface CronJob {
  /** cron.yml のエンドポイント末尾（= cron_logs.job_name）。例: 'daily-summary' */
  name: string;
  /** 管理画面（cron-monitor）の表示名 */
  label: string;
  /** cron.yml の schedule 式（UTC・厳密一致）。heartbeat の期待間隔の基準。 */
  schedule: string;
  /** 期待実行間隔（分）。schedule から導出した定数（drift テストが schedule と整合を検証）。 */
  intervalMinutes: number;
}

// SSOT データは cron-jobs.data.json に切り出している。理由：Render の cron dispatcher
// （scripts/cron-dispatcher.mjs・Node 素の ESM で TypeScript を import できない）が同じ
// スケジュール定義を読む必要があり、TS と .mjs の双方から参照できる単一ソースを JSON に置く。
// これにより「TS 側 / cron.yml / dispatcher」の三重管理ドリフトを JSON 一点に集約する
// （cron.yml との一致は cron-jobs-drift.test.ts、dispatcher との一致は同 JSON 参照で担保）。
// 並びは cron.yml の schedule 定義順（レビュー時の目視突合を容易にするため）。
// intervalMinutes: hourly=60 / daily=1440 / weekly=10080 / 15分=15 / 30分=30。
// 末尾の cron-heartbeat は cron 停止 heartbeat 自身（他ジョブの staleness を検知・30分毎）。
export const CRON_JOBS: CronJob[] = cronJobsData;

/** ジョブ名の配列（cron-monitor の EXPECTED_JOBS 基準リスト）。 */
export const CRON_JOB_NAMES: string[] = CRON_JOBS.map((j) => j.name);

/** ジョブ名 → 表示名（cron-monitor の JOB_LABELS）。 */
export const CRON_JOB_LABELS: Record<string, string> = Object.fromEntries(
  CRON_JOBS.map((j) => [j.name, j.label]),
);

/**
 * heartbeat が「停止」と判定する猶予（分）。
 * 期待間隔 × 2 に固定バッファ 30 分を足す。×2 は「1 回 miss しても即警報しない」ため、
 * +30 は GitHub Actions スケジューラの実行ジッタ（数分〜十数分遅延し得る）を吸収するため。
 * これにより「一過性の遅延で誤警報」を構造的に避けつつ、複数回連続 miss（＝真の停止）は検知する。
 *
 * トレードオフ（意図的・断定）：×2 のため低頻度ジョブは検知が遅い。weekly（interval=10080）の閾値は
 * 20190分≈14日で、週次ジョブ停止の検知に最長約2週間かかる。これは GitHub Actions が
 * 「低頻度スケジュールほど遅延・スキップしやすい」既知挙動を持つため、weekly を短い閾値にすると
 * 正常な遅延で誤警報（さらに /api/health 経由で誤 page）するリスクの方が高いと判断し、
 * 検知の遅さより誤警報回避を優先している。weekly ジョブ（customer-segment / sync-google-ratings /
 * favorites-digest / weekly-report）はいずれも顧客対応クリティカルでないため許容する。
 */
export const CRON_STALE_GRACE_MINUTES = 30;

/** 当該ジョブが「stale（停止疑い）」と判定される最終実行からの経過分。 */
export function cronStaleThresholdMinutes(job: CronJob): number {
  return job.intervalMinutes * 2 + CRON_STALE_GRACE_MINUTES;
}

/**
 * cron-heartbeat 自身の stale 閾値（分）。/api/health の cron probe が
 * 「監視系（heartbeat）そのものが生きているか」を直接判定するのに使う。
 * heartbeat は他ジョブの停止判定から自分を除外するため、自分の停止は heartbeat では検知できない。
 * そこで /api/health がこの閾値で heartbeat の鮮度を見て、監視系ダウン＝全停止も含めて外形報告する。
 */
export const CRON_HEARTBEAT_STALE_THRESHOLD_MINUTES = cronStaleThresholdMinutes(
  CRON_JOBS.find((j) => j.name === 'cron-heartbeat')!,
);
