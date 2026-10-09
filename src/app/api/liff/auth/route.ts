/**
 * POST /api/liff/auth
 * LINEアクセストークンを受け取りLINEプロフィールを検証、
 * line_user_idに紐づくユーザーデータを返す
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { checkCsrf } from '@/lib/csrf';
import { fetchVerifiedLiffProfile } from '@/lib/liff-profile';
import { resolveVerifiedLineOwner } from '@/lib/verified-line-owner';
import { serverError } from '@/lib/with-route';

export async function POST(req: NextRequest) {
  try {
    const csrfError = checkCsrf(req);
    if (csrfError) return csrfError;

    const ip = getClientIp(req);
    if (await checkRateLimit(null, ip, 20, 60_000, 'liff-auth')) {
      return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
    }

    const { access_token } = await req.json();
    if (!access_token || typeof access_token !== 'string') {
      return NextResponse.json({ error: 'access_token required' }, { status: 400 });
    }
    if (access_token.length > 512) {
      return NextResponse.json({ error: 'Invalid access_token' }, { status: 400 });
    }

    const identity = await fetchVerifiedLiffProfile(access_token);
    if (!identity.ok) return NextResponse.json({ error: identity.error }, { status: identity.status });
    if (identity.displayName === undefined) return NextResponse.json({ error: 'Invalid LINE profile response' }, { status: 502 });

    const admin = createServiceRoleClient();

    const owner = await resolveVerifiedLineOwner(admin, identity.lineUserId);
    let profile = null;
    if (owner) {
      const result = await admin.from('profiles').select('id, display_name, email, avatar_url').eq('id', owner).maybeSingle();
      if (result.error) return serverError('liff-auth-profile', result.error, '/api/liff/auth', 'Internal Server Error');
      profile = result.data;
    }

    return NextResponse.json({
      line_user_id: identity.lineUserId,
      display_name: identity.displayName,
      picture_url: identity.pictureUrl ?? null,
      linked: !!profile,
      profile: profile ?? null,
    });
  } catch (e) {
    return serverError('liff-auth', e, '/api/liff/auth', 'Internal Server Error');
  }
}
