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

export async function onRequestError(
  err: unknown,
  request: OnRequestErrorRequest,
  context: OnRequestErrorContext
): Promise<void> {
  try {
    const { alertError } = await import('./lib/alert');
    const errMessage = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : undefined;

    alertError(`[onRequestError] ${errMessage}`, {
      route: request.path,
      status: 500,
      commit_sha: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || null,
      env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
      extra: {
        method: request.method,
        renderSource: context.renderSource,
        routePath: context.routePath,
        routeType: context.routeType,
        stack: errStack ? errStack.split('\n').slice(0, 8).join('\n') : null,
      },
    });
  } catch (e) {
    // 通知系の例外で本体応答を破壊しないよう完全 swallow
    console.error('[instrumentation.onRequestError] alert failed:', e);
  }
}
