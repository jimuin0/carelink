/**
 * Render Cron Job 用の純粋ヘルパー。
 *
 * cron 定刻実行を GitHub Actions の scheduled workflow（public repo で最大283分間引き）から
 * Render Cron Jobs（間引きゼロ・cancel-fee-cron の毎時00分正確発火で実証済み）へ移すための
 * scripts/cron-call.mjs（各 endpoint を叩く）と scripts/health-check.mjs（外形監視）が使う。
 * I/O を含まない純粋関数のため src/lib に置き、render-cron.test.ts で全分岐を決定的に検証する。
 */

/**
 * cron ジョブ名から呼び出し先 URL を解決する。
 * 未知の name（typo・SSOT から消えたジョブ）は誤った endpoint を叩く事故防止のため throw。
 * @param {string} name 例: 'booking-reminder'
 * @param {string[]} validNames cron-jobs.data.json 由来の全ジョブ名
 * @param {string|undefined} baseUrl 例: 'https://carelink-jp.com'
 * @returns {string} 例: 'https://carelink-jp.com/api/cron/booking-reminder'
 */
export function resolveCronEndpoint(name, validNames, baseUrl) {
  if (!validNames.includes(name)) {
    throw new Error(`未知の cron ジョブ名: ${name}（cron-jobs.data.json に存在しない）`);
  }
  if (!baseUrl) {
    throw new Error('CARELINK_BASE_URL 未設定');
  }
  return `${baseUrl.replace(/\/$/, '')}/api/cron/${name}`;
}

/**
 * /api/health のレスポンスが健全か判定する。
 * @param {number} httpStatus
 * @param {unknown} body パース済み JSON（失敗時は null）
 * @returns {boolean}
 */
export function isHealthy(httpStatus, body) {
  return httpStatus === 200 && !!body && body.status === 'healthy';
}

/**
 * 監視アラート用のサマリ文字列を作る。
 * @param {number} httpStatus
 * @param {unknown} body
 * @returns {string}
 */
export function formatHealthSummary(httpStatus, body) {
  const status = body && body.status ? body.status : 'unknown';
  return `HTTP ${httpStatus} / status ${status}`;
}
