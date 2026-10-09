/**
 * 紹介プログラム API（v8.6）
 * GET: 自分の紹介コード取得（なければ自動生成）
 * POST: 紹介コード使用（新規ユーザーが初回予約完了時に呼ぶ）
 */

import { mutationRateLimit, checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { randomInt } from 'crypto';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { withRoute, serverError, authUnavailable } from '@/lib/with-route';
import { verifyAuthUser } from '@/lib/auth-verification';
import { UUID_REGEX } from '@/lib/constants';

export const dynamic = 'force-dynamic';

function generateCode(): string {
  // 暗号論的乱数(randomInt)を用いる。Math.random は予測可能な疑似乱数のため紹介コードに使わない。
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[randomInt(chars.length)];
  return code;
}

export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    if (await checkRateLimit(null, ip, 10, 60_000, 'referral-get')) {
      return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
    }
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const adminSupabase = createServiceRoleClient();

    // 自分が既に他人の紹介コードを使用済みか（適用済みフラグの永続化 = REF-2）。
    // これを返さないと、フロントの「適用済み」表示が再読込で消える。error は best-effort(未適用扱い)。
    const { data: usedRow, error: usedErr } = await adminSupabase
      .from('referral_uses')
      .select('id')
      .eq('referred_user_id', user.id)
      .maybeSingle();
    const already_referred = !usedErr && !!usedRow;

    // 既存コード取得
    const { data: existing } = await adminSupabase
      .from('referral_codes')
      .select('code, used_count')
      .eq('user_id', user.id)
      .maybeSingle();

    if (existing) return NextResponse.json({ ...existing, already_referred });

    // 新規生成
    const code = generateCode();
    const { error: insertErr } = await adminSupabase.from('referral_codes').insert({ user_id: user.id, code });
    if (insertErr) {
      return serverError('referral-code-generate', insertErr, '/api/referral', '紹介コードの生成に失敗しました');
    }
    return NextResponse.json({ code, used_count: 0, already_referred });
  } catch (e) {
    return serverError('referral-get', e, '/api/referral');
  }
}

export const POST = withRoute(async (request) => {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );

  const verification = await verifyAuthUser(supabase.auth);
  if (verification.state === 'unavailable') return authUnavailable('referral-auth', '/api/referral');
  if (verification.state !== 'verified') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const user = verification.user;

  const { code } = await request.json().catch(() => ({}));
  if (!code || typeof code !== 'string' || code.length > 100) return NextResponse.json({ error: 'コードが必要です' }, { status: 400 });

  const adminSupabase = createServiceRoleClient();

  const normalized = code.toUpperCase();
  const applied = await adminSupabase.rpc('apply_referral_code_atomic', { p_user_id: user.id, p_code: normalized });
  if (applied.error) {
    if (applied.error.code === 'P0001') {
      if (applied.error.message === 'REFERRAL_CODE_INVALID') return NextResponse.json({ error: '無効な紹介コードです' }, { status: 400 });
      if (applied.error.message === 'REFERRAL_SELF_USE') return NextResponse.json({ error: '自分のコードは使えません' }, { status: 400 });
      if (applied.error.message === 'REFERRAL_ALREADY_APPLIED') return NextResponse.json({ error: '既に紹介コードを使用済みです' }, { status: 400 });
    }
    return serverError('referral-apply', new Error('Referral use transaction not confirmed'), '/api/referral');
  }
  const result = applied.data?.[0];
  if (applied.data?.length !== 1 || !result || !UUID_REGEX.test(result.use_id) || result.code !== normalized || typeof result.replayed !== 'boolean') {
    return serverError('referral-apply-result', new Error('Referral use transaction result invalid'), '/api/referral');
  }

  // ポイント付与は「被紹介者の初回予約完了時」に applyCompletionSideEffects 経由で行う（A-7 根治）。
  // 適用時に即時付与すると、実来店を伴わず捨てアカウントを量産してコード適用するだけで紹介者に
  // 500pt/件 を無限発行できた（1pt=1円換金可）。ここでは referral_uses を points_awarded=false
  // （DB default）で記録するのみ。実際の付与は awardReferralPointsOnCompletion が予約完了時に行う。

  return NextResponse.json({ success: true, replayed: result.replayed, message: '紹介コードを適用しました。初回のご予約完了で300ポイントが付与されます。' });
}, {
  csrf: true,
  rateLimit: { limiter: mutationRateLimit, limit: 5, windowMs: 60_000, prefix: 'referral' },
  sentryTag: 'referral',
});
