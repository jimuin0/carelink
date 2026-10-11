/**
 * POST /api/liff/link
 * ログイン済みSupabaseユーザーとLINEアカウントを紐付ける
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { fetchVerifiedLiffProfile } from '@/lib/liff-profile';
import { AUTH_UNAVAILABLE_BODY, verifyAuthUser } from '@/lib/auth-verification';
import { serverError } from '@/lib/with-route';

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const ip = getClientIp(req);
  if (await checkRateLimit(null, ip, 10, 60_000, 'liff-link')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  try {
    const supabase = await createServerSupabaseAuthClient();
    const verification = await verifyAuthUser(supabase.auth);
    if (verification.state === 'unavailable') return NextResponse.json(AUTH_UNAVAILABLE_BODY, { status: 503 });
    if (verification.state !== 'verified') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = verification.user;

    const { access_token } = await req.json();
    if (!access_token || typeof access_token !== 'string' || access_token.length > 512) {
      return NextResponse.json({ error: 'access_token required' }, { status: 400 });
    }

    const identity = await fetchVerifiedLiffProfile(access_token);
    if (!identity.ok) return NextResponse.json({ error: identity.error }, { status: identity.status });
    const unknown = () => NextResponse.json({ code: 'LINE_LINK_RESULT_UNKNOWN', error: 'LINE 連携の保存結果を確認できません。同じ本人アカウントと LINE で連携を再確認してください。' }, { status: 503 });
    try {
      const { data, error } = await createServiceRoleClient().rpc('bind_verified_liff_account_atomic', { p_actor_id: user.id, p_line_user_id: identity.lineUserId });
      if (error || (data !== 'linked' && data !== 'conflict')) return unknown();
      if (data === 'conflict') return NextResponse.json({ error: 'このLINEアカウントは別のユーザーに紐付けられているか、既存の連携と一致しません。連携先を確認してください。' }, { status: 409 });
      return NextResponse.json({ ok: true });
    } catch { return unknown(); }
  } catch (e) {
    return serverError('liff-link-post', e, '/api/liff/link');
  }
}

export async function DELETE(req: NextRequest) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const deleteIp = getClientIp(req);
  if (await checkRateLimit(null, deleteIp, 5, 60_000, 'liff-link-delete')) {
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
      return serverError('liff-link-delete-update', unlinkErr, '/api/liff/link');
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return serverError('liff-link-delete', e, '/api/liff/link');
  }
}
