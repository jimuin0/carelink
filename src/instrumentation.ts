/**
 * Next.js 15 instrumentation（Phase 2）
 *
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 *
 * 全 API ルート例外を onRequestError で一箇所に集約し、
 * Sentry に加えて Slack `#alerts-prod` に構造化通知する。
 * 本ファイル追加以前は Sentry 通知が誰にも届かず /api/profile 500 が
 * 数日放置された。これを再発させない最終バリア。
 */

export async function register() {
  // Sentry の初期化は @sentry/nextjs が sentry.server.config.ts /
  // sentry.edge.config.ts を自動 require するため、ここでは何もしない。
  // 将来追加の OTel / pino 等もここで初期化する。
}

interface OnRequestErrorRequest {
  path: string;
  method: string;
  headers: Record<string, string>;
}

interface OnRequestErrorContext {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
  renderSource?: string;
}

/**
 * notFound / redirect は Next.js が意図的に使う制御フローであり、障害通知の対象ではない。
 * production では message が共通文へ置き換わるため、Next が付与する digest だけを判定する。
 */
function isExpectedNavigationError(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('digest' in err)) return false;
  const digest = (err as { digest?: unknown }).digest;
  return typeof digest === 'string' && (
    digest === 'NEXT_NOT_FOUND' ||
    digest.startsWith('NEXT_HTTP_ERROR_FALLBACK;404') ||
    digest.startsWith('NEXT_REDIRECT')
  );
}

export async function onRequestError(
  err: unknown,
  request: OnRequestErrorRequest,
  context: OnRequestErrorContext
): Promise<void> {
  try {
    if (isExpectedNavigationError(err)) return;
    const { alertCaughtError } = await import('./lib/alert');
    // Next.jsが渡す例外には上流本文や利用者入力が入り得る。alertCaughtErrorの固定カテゴリ化を
    // 通し、Slackへmessage/stackを直接転記しない。
    void context;
    void request.method;
    alertCaughtError('onRequestError', err, request.path);
  } catch (e) {
    // 通知系の例外で本体応答を破壊しないよう完全 swallow
    console.error('[instrumentation.onRequestError] alert failed:', e);
  }
}
