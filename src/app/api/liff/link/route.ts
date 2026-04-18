/**
 * POST /api/liff/link
 * ログイン済みSupabaseユーザーとLINEアカウントを紐付ける
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCsrf } from '@/lib/csrf';

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  try {
    const supabase = await createServerSupabaseAuthClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { access_token } = await req.json();
    if (!access_token || typeof access_token !== 'string' || access_token.length > 512) {
      return NextResponse.json({ error: 'access_token required' }, { status: 400 });
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
  try {
    const supabase = await createServerSupabaseAuthClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createServiceRoleClient();
    await admin
      .from('profiles')
      .update({ line_user_id: null, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
