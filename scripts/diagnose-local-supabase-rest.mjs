// 有限のread-only診断。元のREST 200必須testは変更せず、診断結果だけでは合格にしない。
import { pathToFileURL } from 'node:url';

const labels = ['openapi-apikey', 'openapi-bearer', 'public-view-limit0'];
const codes = new Set([
  '57014', '42501', '42P01', '42703', '42883', '53300', '53400', '57P01', '57P03', '08006', 'XX000',
  'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003', 'PGRST100', 'PGRST106', 'PGRST200', 'PGRST202',
  'PGRST204', 'PGRST301', 'PGRST302', 'PGRST303',
]);

export function projectDiagnostic(label, status, body, elapsed) {
  if (!labels.includes(label)) throw new Error('invalid diagnostic label');
  return {
    label,
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0,
    code: codes.has(body?.code) ? body.code : null,
    statementTimeout: typeof body?.message === 'string' && /^canceling statement due to statement timeout$/i.test(body.message),
    elapsedMs: Number.isFinite(elapsed) && elapsed >= 0 ? Math.floor(elapsed) : 0,
  };
}

export async function diagnose(env = process.env, request = fetch, write = console.log) {
  const url = env.STAGING_SUPABASE_URL;
  const key = env.STAGING_SUPABASE_ANON_KEY;
  if (!url || !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\/?$/.test(url) ||
      !key?.trim() || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    throw new Error('isolated local diagnostic inputs required');
  }
  new URL(url);
  const paths = ['/rest/v1/', '/rest/v1/', '/rest/v1/public_reviews?select=id&limit=0'];
  for (const [index, label] of labels.entries()) {
    const start = performance.now();
    let status = 0;
    let body = null;
    try {
      const response = await request(`${url.replace(/\/$/, '')}${paths[index]}`, {
        headers: { apikey: key, ...(index > 0 ? { Authorization: `Bearer ${key}` } : {}) },
        signal: AbortSignal.timeout(5000),
      });
      status = response.status;
      // OpenAPI成功bodyは取得しない。エラーもallowlist projection以外は破棄する。
      if (!response.ok) body = await response.json().catch(() => null);
      else await response.body?.cancel();
    } catch {
      // 通信例外のraw message/URL/headerは出さない。通常Contract testが失敗を判定する。
    }
    write(JSON.stringify(projectDiagnostic(label, status, body, performance.now() - start)));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  diagnose().catch(() => {
    console.error('Local REST diagnostic input guard failed.');
    process.exitCode = 1;
  });
}
