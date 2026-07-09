/**
 * Render Cron Job による CareLink 本番の外形監視。
 *
 * GitHub Actions health-monitor.yml（schedule 依存で間引き＝Issue が1件も発火していなかった）の
 * 代替。Render Cron Job で /api/health を叩き、unhealthy なら Slack 通報する。神原の
 * imakra-cron-health（Render Cron Job で endpoint を叩く監視）と同型。
 *
 * Render Cron Job は都度起動・終了のため状態遷移の記憶は持たない。unhealthy 継続中は毎実行で
 * 通報する（本番ダウン中の通報継続は「気づける」方向で許容）。healthy 時は無音（exit 0）。
 *
 * 環境変数（render.yaml の envVarGroup 経由）:
 *   - CARELINK_BASE_URL      例: https://carelink-jp.com（必須）
 *   - SLACK_BOT_TOKEN        通報用（任意・未設定ならログのみ）
 *   - SLACK_DEFAULT_CHANNEL  同上
 *   - ADMIN_HEARTBEAT_URL    admin-dashboard heartbeat 送信先（任意・未設定なら no-op）
 *   - ADMIN_HEARTBEAT_TOKEN  同上
 */

import { isHealthy, formatHealthSummary } from '../src/lib/render-cron.mjs';

const TIMEOUT_MS = 30_000;
const ADMIN_HEARTBEAT_JOB_ID = 'health-check';

async function pushAdminHeartbeat(status) {
  const url = (process.env.ADMIN_HEARTBEAT_URL || '').trim();
  const token = (process.env.ADMIN_HEARTBEAT_TOKEN || '').trim();
  if (!url || !token) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ project_id: 'carelink', job_id: ADMIN_HEARTBEAT_JOB_ID, status }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('[health-check] admin heartbeat 送信失敗:', res.status);
    }
  } catch (e) {
    console.error('[health-check] admin heartbeat 例外:', e instanceof Error ? e.message : String(e));
  }
}

async function postSlack(text) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_DEFAULT_CHANNEL;
  if (!token || !channel) {
    console.error('[health-check] Slack 未設定のため通報スキップ:', text);
    return;
  }
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel, text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) console.error('[health-check] Slack 投稿失敗:', body.error);
  } catch (e) {
    console.error('[health-check] Slack 例外:', e instanceof Error ? e.message : String(e));
  }
}

async function main() {
  const base = process.env.CARELINK_BASE_URL;
  if (!base) {
    console.error('[health-check] CARELINK_BASE_URL 未設定');
    process.exit(1);
  }
  let httpStatus = 0;
  let body = null;
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/health`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    httpStatus = res.status;
    body = await res.json().catch(() => null);
  } catch (e) {
    await postSlack(`🔴 CareLink production 到達不可（Render 監視）\n> ${e instanceof Error ? e.message : String(e)}`);
    await pushAdminHeartbeat('fail');
    process.exit(0); // 通報済み。Render 側は「実行成功（通報した）」として扱う。
  }
  if (isHealthy(httpStatus, body)) {
    console.log(`[health-check] healthy: ${formatHealthSummary(httpStatus, body)}`);
    await pushAdminHeartbeat('ok');
    return;
  }
  await postSlack(`🔴 CareLink production unhealthy（Render 監視）\n> ${formatHealthSummary(httpStatus, body)}`);
  await pushAdminHeartbeat('fail');
}

main().catch((e) => {
  console.error('[health-check] 例外:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
