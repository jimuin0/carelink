/**
 * Render Cron Job から CareLink の単一 cron endpoint を叩く共通スクリプト。
 *
 * render.yaml の各 cron サービスが `node scripts/cron-call.mjs <job-name>` を startCommand に持つ。
 * <job-name> は cron-jobs.data.json のジョブ名（例: booking-reminder）。実行後は必ず終了する
 * （Render Cron Job は「終了するコマンド」であること）。成功=exit 0 / 失敗=exit 1 で Render が
 * 実行成否を記録し、ダッシュボードで各ジョブ個別に可視化される。
 *
 * 環境変数（render.yaml の envVarGroup 経由）:
 *   - CARELINK_BASE_URL  例: https://carelink-jp.com（必須）
 *   - CRON_SECRET        /api/cron/* の Bearer 認証（必須・Vercel と同値）
 */

import { readFileSync } from 'node:fs';
import { resolveCronEndpoint } from '../src/lib/render-cron.mjs';

const CRON_JOBS = JSON.parse(
  readFileSync(new URL('../src/lib/cron-jobs.data.json', import.meta.url), 'utf8'),
);
const VALID_NAMES = CRON_JOBS.map((j) => j.name);

const JOB_TIMEOUT_MS = 300_000; // cron ジョブ側 maxDuration 60s + 余裕

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error('[cron-call] ジョブ名の引数が必要です（例: node scripts/cron-call.mjs booking-reminder）');
    process.exit(1);
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron-call] CRON_SECRET 未設定');
    process.exit(1);
  }
  // resolveCronEndpoint が未知ジョブ名・BASE_URL 未設定を throw（下の catch で exit 1）。
  const url = resolveCronEndpoint(name, VALID_NAMES, process.env.CARELINK_BASE_URL);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(JOB_TIMEOUT_MS),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    console.error(`[cron-call] ${name} 失敗: HTTP ${res.status} ${text.slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`[cron-call] ${name} 成功: HTTP ${res.status}`);
}

main().catch((e) => {
  console.error('[cron-call] 例外:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
