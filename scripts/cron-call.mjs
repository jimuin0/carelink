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
import { cutoverTime, retiredLegacyJob } from '../src/lib/cron-dispatch.mjs';
import { callCron } from './cron-request.mjs';

const CRON_JOBS = JSON.parse(
  readFileSync(new URL('../src/lib/cron-jobs.data.json', import.meta.url), 'utf8'),
);
const VALID_NAMES = CRON_JOBS.map((j) => j.name);

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error('[cron-call] ジョブ名の引数が必要です（例: node scripts/cron-call.mjs booking-reminder）');
    process.exit(1);
  }
  if (process.env.RENDER_SERVICE_ID && retiredLegacyJob(name,
    cutoverTime(process.env.CARELINK_CRON_DISPATCH_FROM), new Date())) {
    console.log(`[cron-call] ${name} owned by consolidated runner; legacy invocation skipped`);
    return;
  }
  await callCron(name, VALID_NAMES);
}

main().catch((e) => {
  // fetch 例外の message にも上流応答や認証情報が含まれ得るため、Renderログへ出さない。
  void e;
  console.error('[cron-call] 外部呼出し例外（詳細は記録しません）');
  process.exit(1);
});
