import { NextResponse } from 'next/server';
import { withRoute, serverError, type RouteContext } from '@/lib/with-route';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { UUID_REGEX } from '@/lib/constants';
import { readReviewModeration } from '@/lib/review-moderation-state';
import { MY_REVIEWS_LIMIT, type MyReview } from '@/lib/my-reviews';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/review/mine';
const headers = { 'Cache-Control': 'no-store' };

/**
 * ログイン中の投稿者本人の口コミ（2026年10月23日 新設）。?id= を付けると 1 件だけ返す（編集画面用）。
 *
 * 店舗に投稿者のアカウント ID を見せないため、facility_reviews.user_id の閲覧権限を
 * ブラウザのロールから外した（migration 20261023120100）。以前のマイページはブラウザから
 * .eq('user_id', 自分) で読んでいたので、本人の行だけを service_role で読むここへ移した。
 * WHERE の user_id は検証済みのセッションから取り、リクエストの値は使わない。
 */
async function mine(request: Request, ctx: RouteContext) {
  const id = new URL(request.url).searchParams.get('id');
  if (id !== null && !UUID_REGEX.test(id)) {
    return NextResponse.json({ error: '不正なリクエストです' }, { status: 400, headers });
  }
  const db = createServiceRoleClient();
  let query = db.from('facility_reviews')
    .select('id, rating, rating_skill, rating_service, rating_atmosphere, rating_cleanliness, rating_explanation, comment, status, is_flagged, created_at, facility_profiles(name, slug)')
    .eq('user_id', ctx.user!.id);
  if (id !== null) query = query.eq('id', id);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(MY_REVIEWS_LIMIT);
  if (error || !Array.isArray(data)) {
    return serverError('review-mine', error ?? new Error('MY_REVIEWS_UNCONFIRMED'), ROUTE, '口コミを読み込めませんでした');
  }
  if (id !== null && data.length === 0) {
    return NextResponse.json({ error: '口コミが見つかりません' }, { status: 404, headers });
  }
  const { states, error: moderationError } = await readReviewModeration(db, data);
  if (moderationError) {
    return serverError('review-mine-moderation', moderationError, ROUTE, '口コミの公開状況を確認できませんでした');
  }
  const reviews: MyReview[] = data.map((row, i) => {
    const facility = row.facility_profiles as { name: string | null; slug: string | null } | null;
    return {
      id: row.id,
      facility_name: facility?.name || '不明な施設',
      facility_slug: facility?.slug ?? '',
      rating: row.rating,
      rating_skill: row.rating_skill,
      rating_service: row.rating_service,
      rating_atmosphere: row.rating_atmosphere,
      rating_cleanliness: row.rating_cleanliness,
      rating_explanation: row.rating_explanation,
      comment: row.comment,
      status: row.status === 'published' ? 'published' : 'hidden',
      created_at: row.created_at,
      moderation: states[i],
    };
  });
  return NextResponse.json({ reviews }, { headers });
}

export const GET = withRoute(mine, {
  csrf: false, requireAuth: true,
  rateLimit: { limiter: null, limit: 60, windowMs: 60_000, prefix: 'review-mine' },
  sentryTag: 'review-mine',
});
