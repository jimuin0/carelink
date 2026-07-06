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

async function getAuthedUser(request: NextRequest) {
  const cookieStore = await cookies();
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
  const { data: { user } } = await authClient.auth.getUser();
  return user;
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

  const user = await getAuthedUser(request);
  if (!user) return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '入力内容が不正です' }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const avg = Math.round(
    (parsed.data.rating_skill + parsed.data.rating_service + parsed.data.rating_atmosphere +
      parsed.data.rating_cleanliness + parsed.data.rating_explanation) / 5
  );

  // WHERE に user_id を含め、他人のレビューを更新できないことを保証する（IDOR防止）。
  const { data, error } = await admin
    .from('facility_reviews')
    .update({
      rating: avg,
      rating_skill: parsed.data.rating_skill,
      rating_service: parsed.data.rating_service,
      rating_atmosphere: parsed.data.rating_atmosphere,
      rating_cleanliness: parsed.data.rating_cleanliness,
      rating_explanation: parsed.data.rating_explanation,
      comment: parsed.data.comment || null,
    })
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: '更新に失敗しました' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'レビューが見つかりません' }, { status: 404 });

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

  const user = await getAuthedUser(request);
  if (!user) return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });

  const admin = createServiceRoleClient();
  // WHERE に user_id を含め、他人のレビューを削除できないことを保証する（IDOR防止）。
  const { data, error } = await admin
    .from('facility_reviews')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: '削除に失敗しました' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'レビューが見つかりません' }, { status: 404 });

  return NextResponse.json({ success: true });
}
