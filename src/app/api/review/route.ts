/**
 * レビュー投稿 API（v8.22）
 * POST /api/review
 * クライアントから直接Supabaseに書き込む代わりにAPIを経由してIPを記録
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkCsrf } from '@/lib/csrf';
import { mutationRateLimit, checkRateLimit } from '@/lib/rate-limit';
import { verifyRecaptcha } from '@/lib/recaptcha';

export const dynamic = 'force-dynamic';

const ratingAxis = z.number().int().min(1).max(5);

const reviewSchema = z.object({
  facility_id: z.string().uuid(),
  recaptcha_token: z.string().optional(),
  reviewer_name: z.string().min(1).max(50),
  rating_skill: ratingAxis,
  rating_service: ratingAxis,
  rating_atmosphere: ratingAxis,
  rating_cleanliness: ratingAxis,
  rating_explanation: ratingAxis,
  comment: z.string().max(500).optional().nullable(),
  photo_urls: z.array(z.string().url().startsWith('https://')).max(3).optional().nullable(),
});

export async function POST(request: Request) {
  const csrfError = checkCsrf(request);
  if (csrfError) return csrfError;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (await checkRateLimit(mutationRateLimit, ip, 5, 60_000, 'review')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '入力内容が不正です' }, { status: 400 });
  }

  // reCAPTCHA v3 検証（キー設定時のみ）
  if (parsed.data.recaptcha_token && process.env.RECAPTCHA_SECRET_KEY) {
    const captcha = await verifyRecaptcha(parsed.data.recaptcha_token, 'review', 0.4);
    if (!captcha.success) {
      return NextResponse.json({ error: 'Bot検知: 時間をおいて再度お試しください' }, { status: 403 });
    }
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // 24h内に同一施設への投稿チェック
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  if (user) {
    const { data: recent } = await supabase
      .from('facility_reviews')
      .select('id')
      .eq('facility_id', parsed.data.facility_id)
      .eq('user_id', user.id)
      .gte('created_at', since)
      .limit(1);
    if (recent && recent.length > 0) {
      return NextResponse.json({ error: '同じ施設への口コミは24時間に1回までです' }, { status: 429 });
    }
  } else {
    // 未ログインの場合はIPで24h制限
    const { data: recentByIp } = await supabase
      .from('facility_reviews')
      .select('id')
      .eq('facility_id', parsed.data.facility_id)
      .eq('reviewer_ip', ip)
      .gte('created_at', since)
      .limit(1);
    if (recentByIp && recentByIp.length > 0) {
      return NextResponse.json({ error: '同じ施設への口コミは24時間に1回までです' }, { status: 429 });
    }
  }

  // 来店確認
  let isVerifiedVisit = false;
  if (user) {
    const { data: completedBooking } = await supabase
      .from('bookings')
      .select('id')
      .eq('facility_id', parsed.data.facility_id)
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .limit(1);
    isVerifiedVisit = (completedBooking?.length ?? 0) > 0;
  }

  const avg = Math.round(
    (parsed.data.rating_skill + parsed.data.rating_service + parsed.data.rating_atmosphere +
      parsed.data.rating_cleanliness + parsed.data.rating_explanation) / 5
  );

  const { data: review, error } = await supabase
    .from('facility_reviews')
    .insert({
      facility_id: parsed.data.facility_id,
      reviewer_name: parsed.data.reviewer_name,
      rating: avg,
      rating_skill: parsed.data.rating_skill,
      rating_service: parsed.data.rating_service,
      rating_atmosphere: parsed.data.rating_atmosphere,
      rating_cleanliness: parsed.data.rating_cleanliness,
      rating_explanation: parsed.data.rating_explanation,
      comment: parsed.data.comment || null,
      photo_urls: parsed.data.photo_urls?.length ? parsed.data.photo_urls : null,
      reviewer_ip: ip,
      ...(user ? { user_id: user.id, is_verified_visit: isVerifiedVisit } : {}),
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: '投稿に失敗しました' }, { status: 500 });
  }

  // ポイント付与（fire-and-forget）
  // Only award once per user per facility to prevent farming by repeated reviews.
  if (user) {
    supabase.from('user_points')
      .select('id')
      .eq('user_id', user.id)
      .eq('facility_id', parsed.data.facility_id)
      .eq('reason', 'review')
      .limit(1)
      .then(({ data: existing }) => {
        if (!existing || existing.length === 0) {
          supabase.from('user_points').insert({
            user_id: user.id,
            facility_id: parsed.data.facility_id,
            points: 50,
            reason: 'review',
          }).then(() => null, () => null);
        }
      }, () => null);
  }

  return NextResponse.json({ success: true, id: review.id });
}
