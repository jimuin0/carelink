import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { verifyAuthUser } from '@/lib/auth-verification';
import { isLineLoginEnabled } from '@/lib/line-availability';
import {
  hasLineSignupConsent,
  LINE_AUTHORIZE_URL,
  LINE_SIGNUP_CONSENT_COOKIE,
  LINE_SIGNUP_CONSENT_MARKER,
  lineOAuthCallbackUrl,
  lineOAuthOrigin,
} from '@/lib/line-oauth';

export const dynamic = 'force-dynamic';

/** 開始リクエストから読み取る値。読み取りはレート制限を通った後に行う。 */
type StartInput = { rawRedirect: string | null; linkMode: boolean; signupConsent: boolean };

/**
 * LINE OAuth の開始（GET・POST 共通）。route.ts は HTTP メソッド以外を export できないため非 export。
 * GET は 307、POST（フォーム送信）は 303 で返し、ブラウザに遷移先を GET で開かせる。
 */
async function startLineOAuth(
  request: Request,
  status: 303 | 307,
  readInput: () => Promise<StartInput>,
): Promise<NextResponse> {
  // 🔴 リダイレクト先は request.url から作らない（Vercel では内部ホスト 0.0.0.0:3000 になる）。
  const origin = lineOAuthOrigin();
  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, origin), status);
  try {
    const ip = getClientIp(request);
    if (await checkRateLimit(null, ip, 20, 60_000, 'line-auth')) {
      return redirectTo('/auth/login?error=too_many_requests');
    }
    const input = await readInput();
    const rawRedirect = input.rawRedirect || '/mypage';
    const redirect = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/mypage';

    // ボタンを隠していても（isLineLoginEnabled=false）ルートは直接開ける。表示と同じ判定で止める。
    const channelId = process.env.NEXT_PUBLIC_LINE_CHANNEL_ID;
    if (!channelId || !isLineLoginEnabled()) {
      return redirectTo('/auth/login?error=line_not_configured');
    }

    const state = crypto.randomUUID();

    let linkActor: string | null = null;
    if (input.linkMode) {
      const verification = await verifyAuthUser((await createServerSupabaseAuthClient()).auth);
      if (verification.state === 'unavailable') return redirectTo('/auth/login?error=line_auth_unavailable');
      if (verification.state !== 'verified') return redirectTo('/auth/login?redirect=%2Fmypage%2Fprofile');
      linkActor = verification.user.id;
    }

    const cookieStore = await cookies();
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 600,
      path: '/',
    };
    cookieStore.set('line_oauth_state', state, cookieOptions);
    cookieStore.set('line_oauth_redirect', redirect, cookieOptions);
    // Consumed together with OAuth state, and checked against the still-current
    // Supabase identity in the callback before any binding mutation.
    cookieStore.set('line_oauth_link_actor', linkActor ?? '', { ...cookieOptions, maxAge: linkActor ? 600 : 0 });
    // 新規アカウント作成の同意証跡。登録画面のフォーム送信（POST・CSRF 検証済み）で同意が
    // 届いたときだけ、現在の規約版を state と同じ寿命で保存する。それ以外（GET・ログイン・連携）では
    // 古い値を消す（src/lib/line-oauth.ts の「同意の受け渡し」）。
    const signupConsent = !linkActor && input.signupConsent;
    cookieStore.set(LINE_SIGNUP_CONSENT_COOKIE, signupConsent ? LINE_SIGNUP_CONSENT_MARKER : '', { ...cookieOptions, maxAge: signupConsent ? 600 : 0 });

    const lineAuthUrl = new URL(LINE_AUTHORIZE_URL);
    lineAuthUrl.searchParams.set('response_type', 'code');
    lineAuthUrl.searchParams.set('client_id', channelId);
    lineAuthUrl.searchParams.set('redirect_uri', lineOAuthCallbackUrl());
    lineAuthUrl.searchParams.set('state', state);
    lineAuthUrl.searchParams.set('scope', 'profile openid email');

    return NextResponse.redirect(lineAuthUrl.toString(), status);
  } catch (e) {
    safeCaptureException(e, 'line-auth-redirect');
    alertCaughtError('line-auth-redirect', e, '/api/auth/line');
    return redirectTo('/auth/login?error=line_unexpected');
  }
}

/**
 * ログイン画面のボタン・マイページの LINE 連携（mode=link）が開く入口。
 * 🔴 GET は同意 Cookie を決して付けない。URL は誰でも作れて共有できるので、
 * `?intent=signup&consent=...` を付けても無視する（PR#793 レビュー P2）。
 */
export async function GET(request: Request) {
  return startLineOAuth(request, 307, async () => {
    const { searchParams } = new URL(request.url);
    return {
      rawRedirect: searchParams.get('redirect'),
      linkMode: searchParams.get('mode') === 'link',
      signupConsent: false,
    };
  });
}

/**
 * 登録画面の「LINEで登録」フォームの送信先。CSRF（Origin/Referer の host 一致）を最初に検証し、
 * 自サイトのフォームから来たときだけ intent=signup・consent=agreed を同意として扱う。
 * 連携（mode=link）は GET 専用で、ここでは扱わない。
 */
export async function POST(request: Request) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;
  return startLineOAuth(request, 303, async () => {
    // 壊れた本文は「同意なし」として扱う（新規作成は callback が拒否し、既存アカウントのログインは通る）。
    const form = await request.formData().catch(() => new FormData());
    const rawRedirect = form.get('redirect');
    return {
      rawRedirect: typeof rawRedirect === 'string' ? rawRedirect : null,
      linkMode: false,
      signupConsent: hasLineSignupConsent(form),
    };
  });
}
