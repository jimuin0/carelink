import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { alertCaughtError } from '@/lib/alert';

export async function GET(req: NextRequest) {
  try {
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
  const REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/google-calendar/callback`;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 10, 60_000, 'gcal-callback')) {
    return NextResponse.redirect(new URL('/mypage/settings?gcal=error', req.url));
  }
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL('/mypage/settings?gcal=error', req.url));
  }

  if (!code || !state || state.length > 2000) {
    return NextResponse.redirect(new URL('/mypage/settings?gcal=error', req.url));
  }

  // Read and immediately clear the server-side nonce cookie
  const cookieStore = await cookies();
  const savedNonce = cookieStore.get('google_oauth_state')?.value;
  cookieStore.delete('google_oauth_state');

  // Decode state to get userId and verify nonce (CSRF protection)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let userId: string;
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
    userId = decoded.userId;
    if (!UUID_RE.test(userId)) throw new Error('Invalid userId');
    // Reject stale states (> 10 min)
    if (Date.now() - decoded.ts > 10 * 60 * 1000) throw new Error('State expired');

    // Verify nonce against stored cookie using timing-safe comparison
    const nonce: string = decoded.nonce ?? '';
    if (!savedNonce || nonce.length === 0 || savedNonce.length !== nonce.length) {
      throw new Error('Nonce mismatch');
    }
    const nonceMatch = crypto.timingSafeEqual(
      Buffer.from(savedNonce, 'hex'),
      Buffer.from(nonce, 'hex'),
    );
    if (!nonceMatch) throw new Error('Nonce mismatch');
  } catch {
    return NextResponse.redirect(new URL('/mypage/settings?gcal=error', req.url));
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL('/mypage/settings?gcal=error', req.url));
  }

  const tokens = await tokenRes.json();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const admin = createServiceRoleClient();
  // トークン保存失敗を成功扱いにしない。失敗のまま success へ飛ばすと、
  // 連携できたと誤認させつつ以後のカレンダー同期がサイレントに動かなくなる。
  const { error: tokenSaveError } = await admin.from('google_calendar_tokens').upsert({
    user_id: userId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || null,
    expires_at: expiresAt,
    scope: tokens.scope || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (tokenSaveError) {
    return NextResponse.redirect(new URL('/mypage/settings?gcal=error', req.url));
  }

  return NextResponse.redirect(new URL('/mypage/settings?gcal=success', req.url));
  } catch (e) {
    console.error('[google-calendar/callback] unexpected error:', e);
    // catch して 500 を返すと instrumentation.ts の onRequestError に伝播せず Slack 通知が漏れるため明示通知。
    alertCaughtError('gcal-callback', e, '/api/google-calendar/callback');
    return NextResponse.redirect(new URL('/mypage/settings?gcal=error', req.url));
  }
}
