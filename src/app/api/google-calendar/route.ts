import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import crypto from 'crypto';
import { isGoogleCalendarEnabled } from '@/lib/integration-availability';
import { SITE_URL } from '@/lib/constants';
import { serverError } from '@/lib/with-route';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

// GET /api/google-calendar — check connection status
export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 20, 60_000, 'google-calendar-get')) {
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

  // 【2026年7月30日】GOOGLE_CLIENT_ID / SECRET が未設定だと OAuth が成立せず連携できない。
  // 本番は両方とも未設定のまま、マイページに「Googleカレンダーと連携する」ボタンが出ていた。
  // 表示側が設定を知る手段が無かったため、状態と一緒に返す（判定理由は lib/integration-availability.ts）。
  const enabled = isGoogleCalendarEnabled();
  if (!token) return NextResponse.json({ enabled, connected: false });

  const isExpired = new Date(token.expires_at) < new Date();
  return NextResponse.json({ enabled, connected: true, isExpired, updatedAt: token.updated_at });
}

// POST /api/google-calendar — generate OAuth URL
export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 10, 60_000, 'google-calendar')) {
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
      return serverError('google-calendar-disconnect', disconnectErr, '/api/google-calendar');
    }
    return NextResponse.json({ ok: true });
  }

  // Generate OAuth2 authorization URL with CSRF-safe state
    // OAuth の redirect_uri は認可要求と token 交換で完全一致が必須。NEXT_PUBLIC_APP_URL は
  // 本番に未設定で、直参照すると "undefined/api/..." になり Google 側で必ず拒否される。
  // 既定値を持つ SITE_URL（constants.ts が正規化・両ファイル共通）から組み立てる。
  const redirectUri = `${SITE_URL}/api/google-calendar/callback`;
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
