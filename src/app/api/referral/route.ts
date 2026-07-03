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
import { withRoute } from '@/lib/with-route';

export const dynamic = 'force-dynamic';

function generateCode(): string {
  // 暗号論的乱数(randomInt)を用いる。Math.random は予測可能な疑似乱数のため紹介コードに使わない。
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[randomInt(chars.length)];
  return code;
}

export async function GET(request: NextRequest) {
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
    console.error('[referral] code generation failed', { userId: user.id, err: insertErr });
    return NextResponse.json({ error: '紹介コードの生成に失敗しました' }, { status: 500 });
  }
  return NextResponse.json({ code, used_count: 0, already_referred });
}

export const POST = withRoute(async (request) => {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { code } = await request.json().catch(() => ({}));
  if (!code || typeof code !== 'string' || code.length > 100) return NextResponse.json({ error: 'コードが必要です' }, { status: 400 });

  const adminSupabase = createServiceRoleClient();

  // 紹介コード検証
  const { data: referralCode } = await adminSupabase
    .from('referral_codes')
    .select('user_id, used_count')
    .eq('code', code.toUpperCase())
    .maybeSingle();

  if (!referralCode) return NextResponse.json({ error: '無効な紹介コードです' }, { status: 400 });
  if (referralCode.user_id === user.id) return NextResponse.json({ error: '自分のコードは使えません' }, { status: 400 });

  // 既に使用済みか
  const { data: existingUse } = await adminSupabase
    .from('referral_uses')
    .select('id')
    .eq('referred_user_id', user.id)
    .maybeSingle();

  if (existingUse) return NextResponse.json({ error: '既に紹介コードを使用済みです' }, { status: 400 });

  // 使用記録（UNIQUE(referred_user_id) でDB側の二重使用を防ぐ）
  const { error: useInsertError } = await adminSupabase.from('referral_uses').insert({
    code: code.toUpperCase(),
    referred_user_id: user.id,
    referrer_user_id: referralCode.user_id,
  });
  // Handle race: another concurrent request may have inserted first (unique constraint violation)
  if (useInsertError) {
    if (useInsertError.code === '23505') {
      return NextResponse.json({ error: '既に紹介コードを使用済みです' }, { status: 400 });
    }
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }

  // ポイント付与は「被紹介者の初回予約完了時」に applyCompletionSideEffects 経由で行う（A-7 根治）。
  // 適用時に即時付与すると、実来店を伴わず捨てアカウントを量産してコード適用するだけで紹介者に
  // 500pt/件 を無限発行できた（1pt=1円換金可）。ここでは referral_uses を points_awarded=false
  // （DB default）で記録するのみ。実際の付与は awardReferralPointsOnCompletion が予約完了時に行う。

  // 使用回数をDB側でアトミックにインクリメント（read-then-writeのrace conditionを排除）
  // used_count + 1 はDBが計算することでCAS（Compare-And-Swap）的な安全性を確保
  const { error: countErr } = await adminSupabase
    .from('referral_codes')
    .update({ used_count: (referralCode.used_count ?? 0) + 1 })
    .eq('code', code.toUpperCase())
    .eq('used_count', referralCode.used_count ?? 0);
  if (countErr) {
    console.error('[referral] used_count increment failed — referral_uses row committed but count not updated', { code: code.toUpperCase(), err: countErr });
  }

  return NextResponse.json({ success: true, message: '紹介コードを適用しました。初回のご予約完了で300ポイントが付与されます。' });
}, {
  csrf: true,
  rateLimit: { limiter: mutationRateLimit, limit: 5, windowMs: 60_000, prefix: 'referral' },
  sentryTag: 'referral',
});
