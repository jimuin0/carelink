/**
 * CareLink cron dispatcher（Render 常駐 Background Worker）。
 *
 * 目的：GitHub Actions の scheduled workflow は public repo では GitHub 側で大幅に
 * 間引かれ（実測で名目 5 分毎が最大 283 分空く）、cron の定刻実行が保証されない。
 * Render の常駐プロセスで内蔵スケジューラを回すことで、間引きの無い確実な定刻実行にする
 * （神原の auto-payment が Render+APScheduler で実証済みの方式と同型）。
 *
 * 動作：
 *  1. cron ディスパッチ：cron-jobs.data.json の schedule を毎分（分境界で）評価し、
 *     due なジョブの `/api/cron/<name>` を Bearer CRON_SECRET で叩く。
 *     endpoint は冪等（claim/onConflict/sent_at）なので、GitHub Actions と二重に叩かれても安全。
 *  2. 外形監視：`/api/health` を定期チェックし、unhealthy への遷移時のみ Slack 通報
 *     （復旧時も 1 回通報）。GitHub Actions health-monitor.yml の代替。
 *
 * スケジュール定義の SSOT は src/lib/cron-jobs.data.json（TS 側 cron-jobs.ts と共有）。
 * cron 式の評価ロジックは src/lib/cron-schedule.mjs（cron-schedule.test.ts で全分岐検証済み）。
 *
 * 必要な環境変数（Render の Environment に設定）：
 *  - CARELINK_BASE_URL   例: https://carelink-jp.com（必須）
 *  - CRON_SECRET         /api/cron/* の Bearer 認証（必須・Vercel と同値）
 *  - SLACK_BOT_TOKEN     監視/失敗通報用（任意・未設定なら通報せずログのみ）
 *  - SLACK_DEFAULT_CHANNEL 同上
 */

import { readFileSync } from 'node:fs';
import { jobsDueAt } from '../src/lib/cron-schedule.mjs';

const CRON_JOBS = JSON.parse(
  readFileSync(new URL('../src/lib/cron-jobs.data.json', import.meta.url), 'utf8'),
);

const BASE_URL = process.env.CARELINK_BASE_URL;
const CRON_SECRET = process.env.CRON_SECRET;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_DEFAULT_CHANNEL = process.env.SLACK_DEFAULT_CHANNEL;

const JOB_TIMEOUT_MS = 300_000; // cron ジョブ側の maxDuration 60s + 余裕
const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_INTERVAL_MS = 120_000; // 2 分毎の外形監視

function log(msg, extra) {
  const line = `[cron-dispatcher] ${new Date().toISOString()} ${msg}`;
  if (extra !== undefined) console.log(line, extra);
  else console.log(line);
}

/** 起動前提の検証。必須 env が無ければ即 throw（Render ログで即判明・沈黙起動を防ぐ）。 */
function requireEnv() {
  const missing = [];
  if (!BASE_URL) missing.push('CARELINK_BASE_URL');
  if (!CRON_SECRET) missing.push('CRON_SECRET');
  if (missing.length > 0) {
    throw new Error(`必須の環境変数が未設定: ${missing.join(', ')}`);
  }
}

/** Slack へ fire-and-forget 通報（token/channel 未設定ならログのみ・本体を止めない）。 */
async function postSlack(text) {
  if (!SLACK_BOT_TOKEN || !SLACK_DEFAULT_CHANNEL) {
    log('Slack 未設定のため通報スキップ', text);
    return;
  }
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel: SLACK_DEFAULT_CHANNEL, text }),
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) log('Slack 投稿失敗', body.error);
  } catch (e) {
    log('Slack 投稿例外', e instanceof Error ? e.message : String(e));
  }
}

/** 単一 cron ジョブを叩く。成否を返す（throw しない＝他ジョブを巻き込まない）。 */
async function runJob(name) {
  const url = `${BASE_URL}/api/cron/${name}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      signal: AbortSignal.timeout(JOB_TIMEOUT_MS),
    });
    if (!res.ok) {
      log(`ジョブ失敗 ${name}: HTTP ${res.status}`);
      return { name, ok: false, detail: `HTTP ${res.status}` };
    }
    log(`ジョブ成功 ${name}`);
    return { name, ok: true };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    log(`ジョブ例外 ${name}: ${detail}`);
    return { name, ok: false, detail };
  }
}

/** 分境界の tick。due なジョブを並列実行し、失敗は run 単位で集約通報する。 */
async function tick(now) {
  const due = jobsDueAt(CRON_JOBS, now);
  if (due.length === 0) return;
  log(`tick ${now.toISOString()} due=${due.join(',')}`);
  const results = await Promise.all(due.map((n) => runJob(n)));
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    await postSlack(
      `🔴 Render cron dispatcher: ${failed.length}件のジョブ実行に失敗\n` +
        failed.map((f) => `• ${f.name}: ${f.detail}`).join('\n'),
    );
  }
}

// 外形監視の状態（healthy→unhealthy 遷移時のみ通報＝連投抑制）。起動直後は健全と仮定。
let lastHealthy = true;

/** /api/health を叩き、unhealthy への遷移で 1 回通報・復旧で 1 回通報。 */
async function healthCheck() {
  let healthy = false;
  let summary = '';
  try {
    const res = await fetch(`${BASE_URL}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    healthy = res.status === 200 && body.status === 'healthy';
    summary = `HTTP ${res.status} / status ${body.status ?? 'unknown'}`;
  } catch (e) {
    healthy = false;
    summary = `unreachable: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (!healthy && lastHealthy) {
    await postSlack(`🔴 CareLink production unhealthy（Render 監視）\n> ${summary}`);
  } else if (healthy && !lastHealthy) {
    await postSlack('✅ CareLink production recovered（Render 監視）');
  }
  lastHealthy = healthy;
}

/** 分境界に合わせて tick を開始し、外形監視ループも起動する。 */
function start() {
  requireEnv();
  const now = new Date();
  const msToNextMinute = (60 - now.getUTCSeconds()) * 1000 - now.getUTCMilliseconds();
  setTimeout(() => {
    void tick(new Date());
    setInterval(() => void tick(new Date()), 60_000);
  }, msToNextMinute);
  void healthCheck();
  setInterval(() => void healthCheck(), HEALTH_INTERVAL_MS);
  log(`started (jobs=${CRON_JOBS.length}, base=${BASE_URL})`);
}

// 直接実行時のみ起動する（テストからの import では副作用ゼロ）。
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}

export { runJob, tick, healthCheck, requireEnv, start };
