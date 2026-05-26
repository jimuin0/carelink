/**
 * 外部依存呼び出しの安全ラッパー（Phase 3 Layer6 / Defense in Depth）
 *
 * 過去事例: src/lib/rate-limit.ts の `limiter.limit(ip)` が throw → API 全体が 500
 * 任意の外部呼び出しが throw した場合に同様の連鎖死を起こさないよう、
 * 全ての外部依存呼び出し点は本ヘルパー経由を必須化する（ESLint で強制）。
 *
 * 設計原則:
 *   1. 例外を絶対に外に漏らさない（catch して fallback 値を返す）
 *   2. ログは console.error で必ず残す（debugging 必須）
 *   3. fallback は呼び出し側が型で明示的に指定する（暗黙の null 化はしない）
 *
 * Phase 8: Sentry 廃止に伴い、Sentry SDK 呼び出しを削除。
 * エラー通知は src/lib/alert.ts（Slack carelinkBot）経由に統一。
 * 詳細トレースは Vercel logs で確認する運用に切り替え。
 */

interface SafeOptions {
  /** ログ・メトリクスのタグ（必須、検索性のため） */
  tag: string;
  /**
   * 旧 Sentry 連携時の互換オプション。現在は no-op。
   * 将来の代替監視 SDK 追加時に再活用可能。
   */
  reportToSentry?: boolean;
}

/**
 * 非同期外部呼び出しを安全に実行する。
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
    return fallback;
  }
}

/**
 * 同期外部呼び出しを安全に実行する。
 */
export function safeSync<T>(fn: () => T, fallback: T, opts: SafeOptions): T {
  try {
    return fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[safe:${opts.tag}]`, msg);
    return fallback;
  }
}

/**
 * エラー発生を構造化ログに残す。
 * Phase 8 で Sentry 廃止のため console.error のみ。
 * 詳細は Vercel logs で確認、致命的なら src/lib/alert.ts の alertError() で
 * Slack に通知すること。
 */
export function safeCaptureException(error: unknown, tag: string): void {
  const msg = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(`[safeCaptureException:${tag}]`, msg, stack ? `\n${stack}` : '');
}

/**
 * 警告メッセージを構造化ログに残す。
 * Phase 8 で Sentry 廃止のため console 出力のみ。
 */
export function safeCaptureMessage(
  message: string,
  level: 'info' | 'warning' | 'error',
  tag: string,
  extra?: Record<string, unknown>
): void {
  const logger = level === 'info' ? console.info : level === 'warning' ? console.warn : console.error;
  if (extra) {
    logger(`[safeCaptureMessage:${tag}]`, message, extra);
  } else {
    logger(`[safeCaptureMessage:${tag}]`, message);
  }
}
