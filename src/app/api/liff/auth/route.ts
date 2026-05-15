/**
 * POST /api/liff/auth
 * LINEアクセストークンを受け取りLINEプロフィールを検証、
 * line_user_idに紐づくユーザーデータを返す
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

export async function POST(req: NextRequest) {
  try {
    const csrfError = checkCsrf(req);
    if (csrfError) return csrfError;

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    if (inMemoryRateLimit(ip, 20, 60_000, 'liff-auth')) {
      return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
    }

    const { access_token } = await req.json();
    if (!access_token || typeof access_token !== 'string') {
      return NextResponse.json({ error: 'access_token required' }, { status: 400 });
    }
    if (access_token.length > 512) {
      return NextResponse.json({ error: 'Invalid access_token' }, { status: 400 });
    }

    // LINE Profile APIでトークンを検証
    const lineRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!lineRes.ok) {
      return NextResponse.json({ error: 'Invalid LINE token' }, { status: 401 });
    }
    const lineProfile = await lineRes.json() as {
      userId: string;
      displayName: string;
      pictureUrl?: string;
    };

    const admin = createServiceRoleClient();

    // LINE user_idに紐づくprofileを検索
    const { data: profile } = await admin
      .from('profiles')
      .select('id, display_name, email, avatar_url')
      .eq('line_user_id', lineProfile.userId)
      .single();

    return NextResponse.json({
      line_user_id: lineProfile.userId,
      display_name: lineProfile.displayName,
      picture_url: lineProfile.pictureUrl ?? null,
      linked: !!profile,
      profile: profile ?? null,
    });
  } catch (e) {
    console.error('[liff/auth] error:', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
