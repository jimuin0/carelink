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
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { checkCsrf } from './csrf';
import { checkRateLimit, type RateLimitConfig } from './rate-limit';
import { getClientIp } from './client-ip';
import { createServerSupabaseAuthClient } from './supabase-server-auth';
import { safeCaptureException } from './safe';

/**
 * ハンドラに渡される実行コンテキスト。
 * - requireAuth: true のとき user は必ず非 null（未認証は withRoute が 401 で遮断済み）、
 *   supabase は認証済み anon SSR クライアント（ハンドラ内で再生成不要）。
 * - requireAuth 省略時は user / supabase ともに null（後方互換: 既存ハンドラは第2引数を無視）。
 */
export interface RouteContext {
  user: User | null;
  supabase: SupabaseClient | null;
}

/** ハンドラ本体（ユーザー定義）。第2引数で認証コンテキストを受け取る。 */
type Handler = (request: Request, ctx: RouteContext) => Promise<NextResponse>;

/**
 * withRoute が返すラッパー関数の型。
 * Next.js の Route Handler シグネチャ（request のみ／非動的ルート）と互換にするため、
 * 公開される戻り値は 1 引数に固定する（RouteContext は内部でのみ生成・注入する）。
 */
type WrappedHandler = (request: Request) => Promise<NextResponse>;

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
  /**
   * ログイン必須化（既定: false）。
   * true のとき withRoute が auth.getUser() を実行し、未認証なら 401 を返して
   * ハンドラを呼ばない。認証済みなら ctx.user / ctx.supabase をハンドラへ渡す。
   * 各ルートでの getUser 書き忘れ・401 漏れを物理的に防ぐ（発症前予防）。
   */
  requireAuth?: boolean;
  /** Sentry tag（既定: 'route'） */
  sentryTag?: string;
}

/**
 * Route handler を CSRF / RateLimit / catch で包むファクトリー。
 * 内部例外は必ず 500 に変換し本体応答が undefined にならないよう保証する。
 */
export function withRoute(handler: Handler, opts: WithRouteOptions = {}): WrappedHandler {
  const { csrf = true, rateLimit, requireAuth = false, sentryTag = 'route' } = opts;

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

      // 認証必須ルートはここで一元的に検証する（各ルートでの書き忘れを防止）。
      // CSRF / RateLimit 通過後に評価し、未認証は 401 でハンドラを呼ばずに遮断する。
      let ctx: RouteContext = { user: null, supabase: null };
      if (requireAuth) {
        const supabase = await createServerSupabaseAuthClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          return NextResponse.json({ error: '認証が必要です' }, { status: 401 });
        }
        ctx = { user, supabase };
      }

      return await handler(request, ctx);
    } catch (e) {
      safeCaptureException(e, sentryTag);
      return NextResponse.json(
        { error: 'サーバーエラーが発生しました' },
        { status: 500 }
      );
    }
  };
}
