/**
 * cron 式評価の純粋ロジック（Render cron dispatcher 用）。
 *
 * scripts/cron-dispatcher.mjs（Render の常駐 worker）が、cron-jobs.data.json の
 * schedule 式を毎分評価して「今この分に実行すべきジョブ」を決めるのに使う。
 * Node 素の ESM から使うため .mjs（依存ゼロ）。純粋関数なので src/lib に置き、
 * src/lib/__tests__/cron-schedule.test.ts で全分岐を決定的に検証する
 * （cron 誤評価＝ジョブ未実行/誤実行に直結するため「たぶん動く」を許さない）。
 *
 * 対応するフィールド構文（標準 crontab の部分集合。CARELINK の 15 式が使う範囲を厳密に網羅）：
 *   *          … 任意
 *   n          … 単一値（例: 15）
 *   a-b        … 範囲（例: 1-5）
 *   a,b,c      … リスト（例: 7,37）
 *   星/n       … n 間隔（例: 星/15 → 0,15,30,45）。基準は各フィールドの下限。
 * これらは `,` で連結できる（例: 1-5,10）。
 *
 * 【day-of-month と day-of-week の OR セマンティクスについて】
 * 標準 cron は dom と dow の【両方】が `*` 以外の場合に OR で判定するが、CARELINK の
 * 全 15 式は dom と dow の少なくとも一方が必ず `*` である（週次は dow 指定・dom=*、
 * 日次/時次は dow=*）。この前提下では単純 AND と OR は一致するため AND で評価する。
 * 将来 dom と dow を同時指定する式を追加する場合は本前提が崩れるため、
 * cron-schedule.test.ts の前提検証テストが CI で落ちて気づける。
 */

/**
 * 単一 cron フィールドが value にマッチするか。
 * @param {string} field  フィールド式（'*' / 'n' / 'a-b' / 'a,b' / '星/n'）
 * @param {number} value  現在値（分・時・日・月・曜日）
 * @returns {boolean}
 */
export function fieldMatches(field, value) {
  if (field === '*') return true;
  for (const part of field.split(',')) {
    if (part.startsWith('*/')) {
      const step = Number(part.slice(2));
      // step が正の整数でない式は不正 → マッチさせない（誤発火を防ぐ）。
      if (Number.isInteger(step) && step > 0 && value % step === 0) return true;
    } else if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      if (Number.isInteger(a) && Number.isInteger(b) && value >= a && value <= b) return true;
    } else {
      const n = Number(part);
      if (Number.isInteger(n) && n === value) return true;
    }
  }
  return false;
}

/**
 * cron 式（5 フィールド）が指定日時（UTC 基準）にマッチするか。
 * @param {string} expr  '分 時 日 月 曜日'
 * @param {Date} date    判定対象の時刻（UTC で評価）
 * @returns {boolean}
 */
export function cronMatches(expr, date) {
  const parts = expr.trim().split(/\s+/);
  // 5 フィールドでない式は不正 → マッチさせない（誤発火防止）。
  if (parts.length !== 5) return false;
  const [min, hr, dom, mon, dow] = parts;
  return (
    fieldMatches(min, date.getUTCMinutes()) &&
    fieldMatches(hr, date.getUTCHours()) &&
    fieldMatches(dom, date.getUTCDate()) &&
    fieldMatches(mon, date.getUTCMonth() + 1) &&
    fieldMatches(dow, date.getUTCDay())
  );
}

/**
 * 指定時刻に実行すべきジョブ名の配列を返す。
 * @param {Array<{name:string, schedule:string}>} jobs
 * @param {Date} date
 * @returns {string[]}
 */
export function jobsDueAt(jobs, date) {
  return jobs.filter((j) => cronMatches(j.schedule, date)).map((j) => j.name);
}
