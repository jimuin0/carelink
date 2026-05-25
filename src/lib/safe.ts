/**
 * 外部依存呼び出しの安全ラッパー（Phase 3 Layer6 / Defense in Depth）
 *
 * 過去事例: src/lib/rate-limit.ts の `limiter.limit(ip)` が throw → API 全体が 500
 * Upstash 障害だけでなく Sentry / Slack / Resend / LINE / Stripe / Anthropic の
 * 任意の外部呼び出しが throw した場合に同様の連鎖死を起こさないよう、
 * 全ての外部依存呼び出し点は本ヘルパー経由を必須化する（ESLint で強制予定）。
 *
 * 設計原則:
 *   1. 例外を絶対に外に漏らさない（catch して fallback 値を返す）
 *   2. ログは console.error で必ず残す（debugging 必須）
 *   3. Sentry capture は best-effort（Sentry 自体が死んでも本ヘルパーは throw しない）
 *   4. fallback は呼び出し側が型で明示的に指定する（暗黙の null 化はしない）
 */

interface SafeOptions {
  /** ログ・メトリクスのタグ（必須、検索性のため） */
  tag: string;
  /** Sentry capture を行う（既定: true） */
  reportToSentry?: boolean;
}

/**
 * 非同期外部呼び出しを安全に実行する。
 * fn が throw した場合は fallback を返し、本関数自体は throw しない。
 *
 * @example
 *   const slots = await safeAsync(
 *     () => supabase.rpc('get_available_slots', { ... }),
 *     { data: null, error: null },
 *     { tag: 'rpc:get_available_slots' }
 *   );
 */
export async function safeAsync<T>(
  fn: () => Promise<T>,
  fallback: T,
  opts: SafeOptions
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[safe:${opts.tag}]`, msg);
    if (opts.reportToSentry !== false) {
      void reportToSentry(e, opts.tag);
    }
    return fallback;
  }
}

/**
 * 同期外部呼び出しを安全に実行する（少数の同期 API 用）。
 */
export function safeSync<T>(fn: () => T, fallback: T, opts: SafeOptions): T {
  try {
    return fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[safe:${opts.tag}]`, msg);
    if (opts.reportToSentry !== false) {
      void reportToSentry(e, opts.tag);
    }
    return fallback;
  }
}

/**
 * Sentry の captureException を最も安全に呼ぶラッパー。
 * Sentry が初期化されていない / SDK 内部で throw した場合も本関数は throw しない。
 */
async function reportToSentry(error: unknown, tag: string): Promise<void> {
  try {
    const Sentry = await import('@sentry/nextjs');
    Sentry.captureException(error, { tags: { safe_tag: tag } });
  } catch {
    // Sentry 自体の失敗は console.error のみ（既に safe* で出力済みのため再出力しない）
  }
}

/**
 * 直接 Sentry を呼びたい箇所のラッパー（既存の Sentry.captureException 全置換用）。
 * これも throw しない。
 */
export function safeCaptureException(error: unknown, tag: string): void {
  void reportToSentry(error, tag);
}
