import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import crypto from 'crypto';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

// GET /api/google-calendar — check connection status
export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 20, 60_000, 'google-calendar-get')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createServiceRoleClient();
  const { data: token } = await admin
    .from('google_calendar_tokens')
    .select('expires_at, scope, updated_at')
    .eq('user_id', user.id)
    .single();

  if (!token) return NextResponse.json({ connected: false });

  const isExpired = new Date(token.expires_at) < new Date();
  return NextResponse.json({ connected: true, isExpired, updatedAt: token.updated_at });
}

// POST /api/google-calendar — generate OAuth URL
export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (inMemoryRateLimit(ip, 10, 60_000, 'google-calendar')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  if (!googleClientId) {
    return NextResponse.json({ error: 'Google Calendar integration not configured' }, { status: 503 });
  }

  const { action } = await req.json().catch(() => ({}));

  if (action === 'disconnect') {
    const admin = createServiceRoleClient();
    const { error: disconnectErr } = await admin.from('google_calendar_tokens').delete().eq('user_id', user.id);
    if (disconnectErr) {
      console.error('[google-calendar] disconnect failed', { userId: user.id, err: disconnectErr });
      return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // Generate OAuth2 authorization URL with CSRF-safe state
  // 他の base-URL 系と同様にデフォルトを持たせる（未設定だと "undefined/..." になり OAuth が常に失敗していた）
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://carelink-jp.com'}/api/google-calendar/callback`;
  const nonce = crypto.randomBytes(32).toString('hex');
  const state = Buffer.from(JSON.stringify({ userId: user.id, ts: Date.now(), nonce })).toString('base64url');

  const cookieStore = await cookies();
  cookieStore.set('google_oauth_state', nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', googleClientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);

  return NextResponse.json({ authUrl: authUrl.toString() });
}
