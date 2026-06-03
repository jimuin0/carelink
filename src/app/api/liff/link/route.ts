/**
 * POST /api/liff/link
 * ログイン済みSupabaseユーザーとLINEアカウントを紐付ける
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { verifyLineAccessToken } from '@/lib/line';

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (inMemoryRateLimit(ip, 10, 60_000, 'liff-link')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  try {
    const supabase = await createServerSupabaseAuthClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { access_token } = await req.json();
    if (!access_token || typeof access_token !== 'string' || access_token.length > 512) {
      return NextResponse.json({ error: 'access_token required' }, { status: 400 });
    }

    // ★ audience(channel)検証: /v2/profile は発行元チャネル(client_id)を検証しないため、
    //   oauth2/v2.1/verify で自社チャネルID一致を必須化する（他チャネル発行トークンでの
    //   line_user_id 詐称＝被害者LINEの不正紐付けを遮断）。fail-closed。
    const tokenCheck = await verifyLineAccessToken(access_token);
    if (!tokenCheck.ok) {
      return NextResponse.json({ error: 'Invalid LINE token' }, { status: 401 });
    }

    // LINEトークンを検証
    const lineRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!lineRes.ok) {
      return NextResponse.json({ error: 'Invalid LINE token' }, { status: 401 });
    }
    const { userId: lineUserId } = await lineRes.json() as { userId: string };

    const admin = createServiceRoleClient();

    // 別のアカウントが既に紐付けていないか確認
    const { data: existing } = await admin
      .from('profiles')
      .select('id')
      .eq('line_user_id', lineUserId)
      .neq('id', user.id)
      .single();

    if (existing) {
      return NextResponse.json({ error: 'このLINEアカウントは既に別のユーザーに紐付けられています' }, { status: 409 });
    }

    // 紐付け保存
    const { error } = await admin
      .from('profiles')
      .update({ line_user_id: lineUserId, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    if (error) return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const deleteIp = getClientIp(req);
  if (inMemoryRateLimit(deleteIp, 5, 60_000, 'liff-link-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  try {
    const supabase = await createServerSupabaseAuthClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createServiceRoleClient();
    const { error: unlinkErr } = await admin
      .from('profiles')
      .update({ line_user_id: null, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    if (unlinkErr) {
      console.error('[liff/link] LINE unlink update failed', { userId: user.id, err: unlinkErr });
      return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
