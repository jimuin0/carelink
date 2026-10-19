import { resolveCronEndpoint } from '../src/lib/render-cron.mjs';

// Shared by legacy and consolidated runners: unchanged endpoint, method,
// authorization, timeout and safe logging. No automatic retries of side effects.
export async function callCron(name, validNames) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error('CRON_SECRET missing');
  const url = resolveCronEndpoint(name, validNames, process.env.CARELINK_BASE_URL);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    console.error(`[cron-call] ${name} 失敗: HTTP ${res.status}（応答本文は記録しません）`);
    throw new Error('Cron HTTP failure');
  }
  console.log(`[cron-call] ${name} 成功: HTTP ${res.status}`);
}
