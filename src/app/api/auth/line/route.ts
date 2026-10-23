import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { verifyAuthUser } from '@/lib/auth-verification';
import { isLineLoginEnabled } from '@/lib/line-availability';
import {
  hasLineSignupConsent,
  LINE_SIGNUP_CONSENT_COOKIE,
  LINE_SIGNUP_CONSENT_MARKER,
  lineOAuthCallbackUrl,
  lineOAuthOrigin,
} from '@/lib/line-oauth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // 🔴 リダイレクト先は request.url から作らない（Vercel では内部ホスト 0.0.0.0:3000 になる）。
  const origin = lineOAuthOrigin();
  try {
    const ip = getClientIp(request);
    if (await checkRateLimit(null, ip, 20, 60_000, 'line-auth')) {
      return NextResponse.redirect(new URL('/auth/login?error=too_many_requests', origin));
    }
    const { searchParams } = new URL(request.url);
    const rawRedirect = searchParams.get('redirect') || '/mypage';
    const redirect = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/mypage';

    // ボタンを隠していても（isLineLoginEnabled=false）ルートは直接開ける。表示と同じ判定で止める。
    const channelId = process.env.NEXT_PUBLIC_LINE_CHANNEL_ID;
    if (!channelId || !isLineLoginEnabled()) {
      return NextResponse.redirect(new URL('/auth/login?error=line_not_configured', origin));
    }

    const state = crypto.randomUUID();

    let linkActor: string | null = null;
    if (searchParams.get('mode') === 'link') {
      const verification = await verifyAuthUser((await createServerSupabaseAuthClient()).auth);
      if (verification.state === 'unavailable') return NextResponse.redirect(new URL('/auth/login?error=line_auth_unavailable', origin));
      if (verification.state !== 'verified') return NextResponse.redirect(new URL('/auth/login?redirect=%2Fmypage%2Fprofile', origin));
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
    // 新規アカウント作成の同意証跡。登録画面が規約チェック後にだけ付けるマーカーがあるときだけ
    // state と同じ寿命で保存し、それ以外（ログイン画面・直リンク・連携）では古い値を消す。
    const signupConsent = !linkActor && hasLineSignupConsent(searchParams);
    cookieStore.set(LINE_SIGNUP_CONSENT_COOKIE, signupConsent ? LINE_SIGNUP_CONSENT_MARKER : '', { ...cookieOptions, maxAge: signupConsent ? 600 : 0 });

    const callbackUrl = lineOAuthCallbackUrl();

    const lineAuthUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
    lineAuthUrl.searchParams.set('response_type', 'code');
    lineAuthUrl.searchParams.set('client_id', channelId);
    lineAuthUrl.searchParams.set('redirect_uri', callbackUrl);
    lineAuthUrl.searchParams.set('state', state);
    lineAuthUrl.searchParams.set('scope', 'profile openid email');

    return NextResponse.redirect(lineAuthUrl.toString());
  } catch (e) {
    safeCaptureException(e, 'line-auth-redirect');
    alertCaughtError('line-auth-redirect', e, '/api/auth/line');
    return NextResponse.redirect(new URL('/auth/login?error=line_unexpected', origin));
  }
}
