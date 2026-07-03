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
import { getClientIp } from '@/lib/client-ip';
import { verifyRecaptcha } from '@/lib/recaptcha';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { sendPushToFacilityOwners } from '@/lib/push';
import { getFacilityNotificationSettings } from '@/lib/notification-settings';
import { safeCaptureException } from '@/lib/safe';
import { alertCaughtError } from '@/lib/alert';

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

  const ip = getClientIp(request);
  if (await checkRateLimit(mutationRateLimit, ip, 5, 60_000, 'review')) {
    return NextResponse.json({ error: 'リクエストが多すぎます' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '入力内容が不正です' }, { status: 400 });
  }

  // reCAPTCHA v3 検証（fail-closed: secret設定時=本番はtoken必須）
  // ★ 旧実装は `if (token && secret)` でtoken省略時に検証全体を素通り（fail-open）させていた。
  //   recaptcha_token は zod で .optional() のため、攻撃者がtokenを送らないだけでBot検証を
  //   完全バイパスできた。secretが設定されている環境ではtokenを必須化し、欠如・検証失敗の
  //   双方を403で遮断する（発症前予防・fail-closed）。secret未設定の開発環境のみスキップ。
  if (process.env.RECAPTCHA_SECRET_KEY) {
    if (!parsed.data.recaptcha_token) {
      return NextResponse.json({ error: 'Bot検知: 時間をおいて再度お試しください' }, { status: 403 });
    }
    const captcha = await verifyRecaptcha(parsed.data.recaptcha_token, 'review', 0.4);
    if (!captcha.success) {
      return NextResponse.json({ error: 'Bot検知: 時間をおいて再度お試しください' }, { status: 403 });
    }
  }

  const cookieStore = await cookies();
  // auth.getUser() は anon key クライアントで行う（service role でも動作するが設計上分離）
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );
  const supabase = createServiceRoleClient();

  const { data: { user } } = await authClient.auth.getUser();

  // 24h内に同一施設への投稿チェック。
  // facility_reviews に user_id 列は存在しない（設計上一度も追加されていない）ため、
  // ログイン有無を問わず reviewer_ip で判定する（reviewer_ip は投稿時に常に保存される）。
  // 旧実装はログイン時に user_id で絞っており、存在しない列参照で 400 → 重複防止が無効だった。
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from('facility_reviews')
    .select('id')
    .eq('facility_id', parsed.data.facility_id)
    .eq('reviewer_ip', ip)
    .gte('created_at', since)
    .limit(1);
  if (recent && recent.length > 0) {
    return NextResponse.json({ error: '同じ施設への口コミは24時間に1回までです' }, { status: 429 });
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
      // facility_reviews に user_id 列は無い。来店確認フラグのみ保存（ログイン時）。
      // 旧実装は user_id を insert しており列が無いため 400 → ログインユーザーの投稿が全失敗していた。
      ...(user ? { is_verified_visit: isVerifiedVisit } : {}),
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: '投稿に失敗しました' }, { status: 500 });
  }

  // ポイント付与（fire-and-forget）
  // Keyed on review ID so one award per review submission.
  if (user && review) {
    const reviewReason = `口コミポイント (${review.id.slice(0, 8)})`;
    supabase.from('user_points')
      .select('id')
      .eq('user_id', user.id)
      .eq('reason', reviewReason)
      .limit(1)
      .then(({ data: existing, error: selectErr }) => {
        if (selectErr) {
          console.error('[review] points dedup check failed', { userId: user.id, reviewId: review.id, err: selectErr });
          return;
        }
        if (!existing || existing.length === 0) {
          supabase.from('user_points').insert({
            user_id: user.id,
            points: 50,
            reason: reviewReason,
          }).then(({ error: insertErr }) => {
            if (insertErr) console.error('[review] points insert failed', { userId: user.id, reviewId: review.id, err: insertErr });
          });
        }
      });
  }

  // 施設オーナーへの口コミ投稿 Push（non-blocking）。施設の通知設定 push_on_review で制御する。
  // 旧実装は口コミ投稿時に店への通知が一切無く、設定トグルが効かない飾りだった。
  try {
    const notif = await getFacilityNotificationSettings(parsed.data.facility_id);
    if (notif.pushOnReview) {
      sendPushToFacilityOwners(parsed.data.facility_id, {
        title: '新しい口コミが投稿されました',
        body: `${parsed.data.reviewer_name}様より★${avg}の口コミが届きました`,
        url: '/admin/reviews',
        tag: `review-${review.id}`,
      }).catch((e) => {
        console.error('[review] push failed', e);
        safeCaptureException(e, 'review-push');
        alertCaughtError('review-push', e, '/api/review');
      });
    }
  } catch (e) {
    console.error('[review] push setup failed', e);
    safeCaptureException(e, 'review-push-setup');
    alertCaughtError('review-push-setup', e, '/api/review');
  }

  return NextResponse.json({ success: true, id: review.id });
}
