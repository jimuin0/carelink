import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import * as Sentry from '@sentry/nextjs';
import { inMemoryRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    if (inMemoryRateLimit(ip, 20, 60_000, 'line-auth')) {
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

    const callbackUrl = `${new URL(request.url).origin}/api/auth/line/callback`;

    const lineAuthUrl = new URL('https://access.line.me/oauth2/v2.1/authorize');
    lineAuthUrl.searchParams.set('response_type', 'code');
    lineAuthUrl.searchParams.set('client_id', channelId);
    lineAuthUrl.searchParams.set('redirect_uri', callbackUrl);
    lineAuthUrl.searchParams.set('state', state);
    lineAuthUrl.searchParams.set('scope', 'profile openid email');

    return NextResponse.redirect(lineAuthUrl.toString());
  } catch (e) {
    Sentry.captureException(e, { tags: { feature: 'line-auth-redirect' } });
    return NextResponse.redirect(new URL('/auth/login?error=line_unexpected', request.url));
  }
}
