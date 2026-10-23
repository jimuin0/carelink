/**
 * レビュー編集・削除 API（投稿者本人のみ）
 * PATCH/DELETE /api/review/[id]
 *
 * facility_reviews.user_id（2026年7月6日DDL追加）で投稿者本人を判定する。
 * IPアドレスは共有・変動しうるため本人確認には使わない。
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX as uuidRegex } from '@/lib/constants';
import { serverError, authUnavailable } from '@/lib/with-route';
import { verifyAuthUser } from '@/lib/auth-verification';
import { findMedicalAdViolations } from '@/lib/medical-ad-guard';

export const dynamic = 'force-dynamic';

const ratingAxis = z.number().int().min(1).max(5);

const updateSchema = z.object({
  rating_skill: ratingAxis,
  rating_service: ratingAxis,
  rating_atmosphere: ratingAxis,
  rating_cleanliness: ratingAxis,
  rating_explanation: ratingAxis,
  comment: z.string().max(500).optional().nullable(),
});

async function getAuthedUser() {
  const cookieStore = await cookies();
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
  return verifyAuthUser(authClient.auth);
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(mutationRateLimit, ip, 10, 60_000, 'review-edit')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!uuidRegex.test(params.id)) {
    return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 });
  }

  const identity = await getAuthedUser();
  if (identity.state === 'unavailable') return authUnavailable('review-edit-auth', '/api/review/[id]');
  if (identity.state !== 'verified') return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  const user = identity.user;

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '入力内容が不正です' }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  // 禁止表現があれば旗（is_flagged）を「本文が変わっていたら立てる」候補として渡す。立てるかどうかは
  // edit_review_atomic が行ロックの中で保存済みの本文と比べて決める（2026年10月23日 migration 20261023120000）。
  // 本文が同じ（星だけの編集）なら保存済みの審査結果を残すので、運営が承認した口コミが星の編集だけで
  // 審査待ちにも載らないまま非公開になることはない。ここで保存済みの本文を読んで比べないのは、
  // 読み取りと書き込みの間に別の編集が入ると、変わった本文の旗を落とし得るため。
  const violations = findMedicalAdViolations(parsed.data.comment);
  const { data, error } = await admin.rpc('edit_review_atomic', {
    p_actor_id: user.id,
    p_review_id: params.id,
    p_patch: {
      ...parsed.data,
      comment: parsed.data.comment || null,
      ...(violations.length > 0 ? { is_flagged: true,
        flag_reason: `医療広告ガイドラインの禁止表現: ${violations.map(v => v.term).join('、')}` } : {}),
    },
  });
  if (error) return serverError('review-patch', error, '/api/review/[id]', '更新に失敗しました');
  if (Array.isArray(data) && data.length === 0) return NextResponse.json({ error: 'レビューが見つかりません' }, { status: 404 });
  if (!Array.isArray(data) || data.length !== 1 || data[0]?.id !== params.id) {
    return serverError('review-patch-result', new Error('Review edit result not confirmed'), '/api/review/[id]');
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = getClientIp(request);
  if (await checkRateLimit(mutationRateLimit, ip, 10, 60_000, 'review-delete')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }
  if (!uuidRegex.test(params.id)) {
    return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 });
  }

  const identity = await getAuthedUser();
  if (identity.state === 'unavailable') return authUnavailable('review-delete-auth', '/api/review/[id]');
  if (identity.state !== 'verified') return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  const user = identity.user;

  const admin = createServiceRoleClient();
  // WHERE に user_id を含め、他人のレビューを削除できないことを保証する（IDOR防止）。
  const { data, error } = await admin
    .from('facility_reviews')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select('id')
    // .maybeSingle(): 0行（他人のレビュー/存在しないid）を not found として扱うため。
    // .single() だと PGRST116 で if(error)→500 が先に発火し 404 分岐が到達不能になる。
    .maybeSingle();

  if (error) return serverError('review-delete', error, '/api/review/[id]', '削除に失敗しました');
  if (!data) return NextResponse.json({ error: 'レビューが見つかりません' }, { status: 404 });

  return NextResponse.json({ success: true });
}
