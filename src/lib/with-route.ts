/**
 * API Route ハンドラ標準ボイラープレート（Phase 3 Layer6）
 *
 * CSRF / RateLimit / try-catch / Sentry 通報 を集約して書き忘れを物理的に防ぐ。
 * `/api/profile` で Sentry catch が握り潰し→ Slack 通知遅延した事象等の再発防止。
 *
 * @example
 *   // src/app/api/example/route.ts
 *   export const POST = withRoute(async (req) => {
 *     const body = await req.json();
 *     // ... 本来のロジック
 *     return NextResponse.json({ ok: true });
 *   }, {
 *     csrf: true,
 *     rateLimit: { limiter: mutationRateLimit, limit: 10, windowMs: 60_000, prefix: 'example' },
 *   });
 */

import { NextResponse } from 'next/server';
import { checkCsrf } from './csrf';
import { checkRateLimit, type RateLimitConfig } from './rate-limit';
import { getClientIp } from './client-ip';
import { safeCaptureException } from './safe';

type Handler = (request: Request) => Promise<NextResponse>;

interface WithRouteOptions {
  /** CSRF 検証を行う（既定: true、GET は通常 false） */
  csrf?: boolean;
  /** Rate limit 設定（指定時のみ適用） */
  rateLimit?: {
    limiter: RateLimitConfig | null;
    limit: number;
    windowMs: number;
    prefix: string;
  };
  /** Sentry tag（既定: 'route'） */
  sentryTag?: string;
}

/**
 * Route handler を CSRF / RateLimit / catch で包むファクトリー。
 * 内部例外は必ず 500 に変換し本体応答が undefined にならないよう保証する。
 */
export function withRoute(handler: Handler, opts: WithRouteOptions = {}): Handler {
  const { csrf = true, rateLimit, sentryTag = 'route' } = opts;

  return async function wrapped(request: Request): Promise<NextResponse> {
    try {
      if (csrf) {
        const csrfError = checkCsrf(request);
        if (csrfError) return csrfError;
      }

      if (rateLimit) {
        // クライアント詐称可能な x-forwarded-for 先頭値ではなく、
        // 信頼できるプラットフォーム由来IP（x-real-ip 優先・XFF末尾）を使う。
        const ip = getClientIp(request);
        if (
          await checkRateLimit(
            rateLimit.limiter,
            ip,
            rateLimit.limit,
            rateLimit.windowMs,
            rateLimit.prefix
          )
        ) {
          return NextResponse.json(
            { error: '短時間に多くのリクエストがありました。しばらくお待ちください。' },
            { status: 429 }
          );
        }
      }

      return await handler(request);
    } catch (e) {
      safeCaptureException(e, sentryTag);
      return NextResponse.json(
        { error: 'サーバーエラーが発生しました' },
        { status: 500 }
      );
    }
  };
}
