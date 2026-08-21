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
 *
 * 🔴 2026年8月20日追記（docs/register-blocker-instructions.md §3 P0-2）:
 * 下の catch は「throw された例外」でしか発火しない。ハンドラが例外を投げず
 * `return NextResponse.json(..., { status: 500 })` した場合（＝ハンドラ内で自前 try/catch
 * している、あるいは Supabase の `{ data, error }` 形の失敗をそのまま 500 で返している等）は
 * この catch を素通りし、safeCaptureException も alertCaughtError も呼ばれない。
 * 実測（2026年8月20日・src/app/api/**\/route.ts を機械走査）: `status: 500` の return は
 * 278箇所/122ファイル。うち withRoute を通っている（=下の handler 呼び出しの戻り値として
 * 素通しされる）ものだけでも 11ファイルあり、当時それらは全て「ハンドラが自前で catch して
 * 500 を return する」形だったため、この構造的な穴を1箇所ずつ塞ぐのではなく、
 * `handler` の戻り値そのものを見て 500 なら通知する（下記）ことで一括で塞ぐ。
 * withRoute を使っていない route.ts（本ファイルの外）はこの経路の対象外のまま残るため、
 * `src/__tests__/silent-500-guard.test.ts` が別途それを機械監視する。
 */

import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { checkCsrf } from './csrf';
import { checkRateLimit, type RateLimitConfig } from './rate-limit';
import { getClientIp } from './client-ip';
import { createServerSupabaseAuthClient } from './supabase-server-auth';
import { safeCaptureException } from './safe';
import { alertCaughtError } from './alert';

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

/**
 * `serverError()` が付与する内部専用フラグヘッダー。
 *
 * ハンドラが（withRoute の catch を通らずに）自前で 500 を「return」する箇所から
 * `serverError()` を使うと、そこで既に safeCaptureException + alertCaughtError が
 * 呼ばれている。下の wrapped() は handler の戻り値が 500 なら追加で通知しようとするため、
 * 何もしなければ「serverError 側」と「wrapped 側」の二重通知になる。
 * このヘッダーは「もう通知済み」の目印として使い、wrapped() 側で見つけたら抑止する。
 *
 * x- 始まりの内部用ヘッダーであり、値は固定文字列 '1' のみ（原因文字列やスタック等の
 * 実データは一切載せない）ため、抑止判定の前にクライアントへ応答が漏れても無害。
 * とはいえ「内部用ヘッダーが外部から観測できる」こと自体が望ましくないため、
 * wrapped() は抑止判定の直後に必ず削除してから応答を返す。
 */
const ALERTED_HEADER = 'x-clnk-alerted-500';

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

      const res = await handler(request, ctx);

      // 🔴 catch（下）は throw された例外でしか発火しない。ハンドラが例外を投げずに
      // 500 を「return」した場合はここで拾う（上のファイル冒頭コメント参照）。
      // serverError() 経由で既に通知済み（ALERTED_HEADER 付与）なら二重通知を避けて
      // 抑止するだけにする。ヘッダーはどちらの分岐でも応答前に必ず削除する
      // （内部用ヘッダーを外部へ漏らさないため）。
      if (res.status >= 500) {
        if (res.headers.has(ALERTED_HEADER)) {
          res.headers.delete(ALERTED_HEADER);
        } else {
          alertCaughtError(
            sentryTag,
            new Error(`handler returned ${res.status}`),
            new URL(request.url).pathname
          );
        }
      }
      return res;
    } catch (e) {
      safeCaptureException(e, sentryTag);
      // catch して 500 を返すと例外が instrumentation.ts の onRequestError に
      // 伝播せず Slack 通知が漏れる（/api/profile 級の盲点）。catch 経路でも
      // 必ず Slack に通知する（fire-and-forget・本体応答は妨げない）。
      alertCaughtError(sentryTag, e, new URL(request.url).pathname);
      return NextResponse.json(
        { error: 'サーバーエラーが発生しました' },
        { status: 500 }
      );
    }
  };
}

/**
 * 通知つき 500 ヘルパー（docs/register-blocker-instructions.md §3 P0-2）。
 *
 * ハンドラが例外を投げずに（＝ withRoute の catch を通らずに）500 を「return」する箇所
 * ―― 自前の try/catch や Supabase の `{ data, error }` 形の失敗判定など ―― から使う。
 * `cause`（元の例外・Supabase の error オブジェクト等）を safeCaptureException +
 * alertCaughtError に渡すため、withRoute の catch から入る 500 と同じ粒度で原因が
 * Slack/ログに載る（`new Error('handler returned 500')` のような原因不明の通知にならない）。
 *
 * withRoute でラップされたルートから使っても二重通知にはならない：ALERTED_HEADER を
 * 付与し、wrapped() 側がそれを見て自身の通知を抑止する（応答前にヘッダーは削除される）。
 * withRoute を使っていないルートから使う場合は、この関数自体が通知の唯一の発火点になる。
 *
 * fire-and-forget（alertCaughtError は throw しない・runAfterResponse 経由なので応答は
 * 遅延しない）。本体の応答生成はこの関数が返す NextResponse で完結する。
 */
export function serverError(
  tag: string,
  cause: unknown,
  route: string,
  userMessage: string | null = 'サーバーエラーが発生しました',
  extraBody?: Record<string, unknown>
): NextResponse {
  safeCaptureException(cause, tag);
  alertCaughtError(tag, cause, route);
  // 🔴 body の形を呼び出し側に合わせられるようにしてあるのは、【形が合わないという理由だけで
  //   通知経路の外に留まる 500 を作らせない】ため。既存の応答から 1 バイトでも形が変わると
  //   それを読んでいる画面や監視が壊れるので、「serverError を使うと body が変わる」状態は
  //   そのまま「使わない言い訳」になり、無音の 500 が残り続ける。
  //   - extraBody … `{error}` に加えて返したい項目（例: slots: [] を返さないと画面が落ちる）
  //   - userMessage: null … `error` キー自体を出さない（例: /api/alert-check の `{ok,message}`）
  const body: Record<string, unknown> =
    userMessage === null ? { ...extraBody } : { error: userMessage, ...extraBody };
  const res = NextResponse.json(body, { status: 500 });
  res.headers.set(ALERTED_HEADER, '1');
  return res;
}
