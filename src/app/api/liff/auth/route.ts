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
import { verifyLineAccessToken } from '@/lib/line';
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

    // ★ audience(channel)検証: /v2/profile は発行元チャネル(client_id)を検証しないため、
    //   oauth2/v2.1/verify で自社チャネルID一致を必須化する（他チャネル発行トークンでの
    //   line_user_id 詐称＝アカウント乗っ取りを遮断）。fail-closed。
    const tokenCheck = await verifyLineAccessToken(access_token);
    if (!tokenCheck.ok) {
      return NextResponse.json({ error: 'Invalid LINE token' }, { status: 401 });
    }

    // LINE Profile APIでトークンを検証
    let lineRes: Response;
    try {
      lineRes = await fetch('https://api.line.me/v2/profile', {
        headers: { Authorization: `Bearer ${access_token}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return NextResponse.json({ error: 'LINE service temporarily unavailable' }, { status: 503 });
    }
    if (!lineRes.ok) {
      if (lineRes.status === 401 || lineRes.status === 403) {
        return NextResponse.json({ error: 'Invalid LINE token' }, { status: 401 });
      }
      const status = lineRes.status === 429 || lineRes.status >= 500 ? 503 : 502;
      return NextResponse.json({ error: 'LINE service temporarily unavailable' }, { status });
    }
    let lineProfile: {
      userId: string;
      displayName: string;
      pictureUrl?: string;
    };
    try {
      const payload = await lineRes.json() as Partial<typeof lineProfile>;
      if (typeof payload.userId !== 'string' || !payload.userId || typeof payload.displayName !== 'string') {
        return NextResponse.json({ error: 'Invalid LINE profile response' }, { status: 502 });
      }
      lineProfile = payload as typeof lineProfile;
    } catch {
      return NextResponse.json({ error: 'Invalid LINE profile response' }, { status: 502 });
    }

    const admin = createServiceRoleClient();

    // LINE user_idに紐づくprofileを検索
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, display_name, email, avatar_url')
      .eq('line_user_id', lineProfile.userId)
      .maybeSingle();
    if (profileError) {
      return serverError('liff-auth-profile', profileError, '/api/liff/auth', 'Internal Server Error');
    }

    return NextResponse.json({
      line_user_id: lineProfile.userId,
      display_name: lineProfile.displayName,
      picture_url: lineProfile.pictureUrl ?? null,
      linked: !!profile,
      profile: profile ?? null,
    });
  } catch (e) {
    return serverError('liff-auth', e, '/api/liff/auth', 'Internal Server Error');
  }
}
