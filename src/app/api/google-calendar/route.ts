import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCsrf } from '@/lib/csrf';
import crypto from 'crypto';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
// GOOGLE_CLIENT_SECRET is used in the callback route, not here
const REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/google-calendar/callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

// GET /api/google-calendar — check connection status
export async function GET() {
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
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!GOOGLE_CLIENT_ID) {
    return NextResponse.json({ error: 'Google Calendar integration not configured' }, { status: 503 });
  }

  const { action } = await req.json().catch(() => ({}));

  if (action === 'disconnect') {
    const admin = createServiceRoleClient();
    await admin.from('google_calendar_tokens').delete().eq('user_id', user.id);
    return NextResponse.json({ ok: true });
  }

  // Generate OAuth2 authorization URL with CSRF-safe state
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
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);

  return NextResponse.json({ authUrl: authUrl.toString() });
}
