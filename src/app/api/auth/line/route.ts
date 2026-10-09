import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { verifyAuthUser } from '@/lib/auth-verification';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const ip = getClientIp(request);
    if (await checkRateLimit(null, ip, 20, 60_000, 'line-auth')) {
      return NextResponse.redirect(new URL('/auth/login?error=too_many_requests', request.url));
    }
    const { searchParams } = new URL(request.url);
    const rawRedirect = searchParams.get('redirect') || '/mypage';
    const redirect = rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/mypage';

    const channelId = process.env.NEXT_PUBLIC_LINE_CHANNEL_ID;
    if (!channelId) {
      return NextResponse.redirect(new URL('/auth/login?error=line_not_configured', request.url));
    }

    const state = crypto.randomUUID();

    let linkActor: string | null = null;
    if (searchParams.get('mode') === 'link') {
      const verification = await verifyAuthUser((await createServerSupabaseAuthClient()).auth);
      if (verification.state === 'unavailable') return NextResponse.redirect(new URL('/auth/login?error=line_auth_unavailable', request.url));
      if (verification.state !== 'verified') return NextResponse.redirect(new URL('/auth/login?redirect=%2Fmypage%2Fprofile', request.url));
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

    const callbackUrl = `${new URL(request.url).origin}/api/auth/line/callback`;

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
    return NextResponse.redirect(new URL('/auth/login?error=line_unexpected', request.url));
  }
}
