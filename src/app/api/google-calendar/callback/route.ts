import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { alertCaughtError } from '@/lib/alert';
import { SITE_URL } from '@/lib/constants';

export async function GET(req: NextRequest) {
  try {
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
    // OAuth の redirect_uri は認可要求と token 交換で完全一致が必須。NEXT_PUBLIC_APP_URL は
  // 本番に未設定で、直参照すると "undefined/api/..." になり Google 側で必ず拒否される。
  // 既定値を持つ SITE_URL（constants.ts が正規化・両ファイル共通）から組み立てる。
  const REDIRECT_URI = `${SITE_URL}/api/google-calendar/callback`;
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
    // Reject malformed, future-dated, or stale states (> 10 min).
    if (!Number.isFinite(decoded.ts) || decoded.ts > Date.now() || Date.now() - decoded.ts > 10 * 60 * 1000) {
      throw new Error('State expired or invalid');
    }

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

  // Bind the state to the authenticated browser session as well as its nonce. A valid
  // nonce must not authorize saving a token for a different user encoded in state.
  const authClient = await createServerSupabaseAuthClient();
  const { data: { user: currentUser } } = await authClient.auth.getUser();
  if (!currentUser || currentUser.id !== userId) {
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

  const tokenPayload = await tokenRes.json() as unknown;
  const tokenRecord = tokenPayload && typeof tokenPayload === 'object'
    ? tokenPayload as Record<string, unknown>
    : null;
  const accessToken = tokenRecord?.access_token;
  const expiresIn = tokenRecord?.expires_in;
  if (
    typeof accessToken !== 'string' || !accessToken ||
    typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0
  ) {
    return NextResponse.redirect(new URL('/mypage/settings?gcal=error', req.url));
  }
  const refreshToken = typeof tokenRecord?.refresh_token === 'string' && tokenRecord.refresh_token.length > 0
    ? tokenRecord.refresh_token
    : null;
  const scope = tokenRecord?.scope;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  const admin = createServiceRoleClient();
  const { data: existingToken, error: existingTokenError } = await admin
    .from('google_calendar_tokens')
    .select('refresh_token')
    .eq('user_id', userId)
    .maybeSingle();
  if (existingTokenError) {
    return NextResponse.redirect(new URL('/mypage/settings?gcal=error', req.url));
  }
  // トークン保存失敗を成功扱いにしない。失敗のまま success へ飛ばすと、
  // 連携できたと誤認させつつ以後のカレンダー同期がサイレントに動かなくなる。
  const tokenFields = {
    access_token: accessToken,
    expires_at: expiresAt,
    scope: typeof scope === 'string' && scope ? scope : null,
    updated_at: new Date().toISOString(),
  };
  let tokenSaveError: { message?: string } | null;
  if (refreshToken) {
    const result = await admin.from('google_calendar_tokens').upsert({
      user_id: userId,
      ...tokenFields,
      refresh_token: refreshToken,
    }, { onConflict: 'user_id' });
    tokenSaveError = result.error;
  } else if (existingToken?.refresh_token) {
    // Update without the refresh_token column so even a concurrent callback cannot
    // replace the durable refresh credential with null.
    const result = await admin.from('google_calendar_tokens').update(tokenFields).eq('user_id', userId);
    tokenSaveError = result.error;
  } else {
    // A first-time connection without a refresh token cannot keep syncing after the
    // access token expires. Do not persist a misleading, non-renewable connection.
    return NextResponse.redirect(new URL('/mypage/settings?gcal=error', req.url));
  }
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
