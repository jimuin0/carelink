import { NextResponse } from 'next/server';
import { withRoute, serverError, type RouteContext } from '@/lib/with-route';
import { getAdminFacilityIds, resolveTargetFacilityId } from '@/lib/facility-membership';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { readReviewModeration } from '@/lib/review-moderation-state';
import { ADMIN_REVIEW_FILTERS, ADMIN_REVIEW_LIST_LIMIT, type AdminReview } from '@/lib/admin-review-list';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/admin/reviews';
const headers = { 'Cache-Control': 'no-store' };

/**
 * 店舗の口コミ管理画面の一覧（2026年10月23日 新設）。
 *
 * 以前の画面はブラウザから facility_reviews を select('*') で読んでおり、画面に出さない
 * 投稿者の IP アドレス（reviewer_ip）とアカウント ID（user_id）まで店舗のブラウザに届いていた。
 * user_id は自店の予約と突き合わせられるので、ニックネームの投稿者を特定できた。
 * ここでは画面に出す列だけを読み、運営の審査状態（運営の確認中／運営判断で非公開）を添えて返す。
 * 口コミはログイン中ユーザーのクライアントで読む（facility_reviews_member_read の RLS と、
 * 20261023120100 の列権限も重ねて効く）。審査状態は店舗が読めない moderation_queue にあるので、
 * 所属を確かめた店舗の口コミ ID についてだけ service_role で読む。
 */
async function list(request: Request, ctx: RouteContext) {
  const params = new URL(request.url).searchParams;
  const filter = params.get('filter') ?? 'all';
  if (!(ADMIN_REVIEW_FILTERS as readonly string[]).includes(filter)) {
    return NextResponse.json({ error: '絞り込みの指定が不正です' }, { status: 400, headers });
  }
  const facilityIds = await getAdminFacilityIds(ctx.supabase!, ctx.user!.id, ROUTE);
  if (facilityIds instanceof NextResponse) return facilityIds;
  const { facilityId, reason } = resolveTargetFacilityId(facilityIds, params.get('facility_id'));
  if (reason === 'none' || reason === 'forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers });
  if (reason === 'ambiguous') return NextResponse.json({ error: '店舗を指定してください' }, { status: 400, headers });

  let query = ctx.supabase!
    .from('facility_reviews')
    .select('id, reviewer_name, rating, comment, status, is_flagged, created_at')
    .eq('facility_id', facilityId);
  // 『公開中』は店舗ページに実際に出ているもの（公開ビューと同じ is_flagged = false 条件）。
  // 運営の確認中・運営判断で非公開は status に関係なく『運営の確認』に分ける。
  if (filter === 'published') query = query.eq('status', 'published').eq('is_flagged', false);
  else if (filter === 'hidden') query = query.eq('status', 'hidden').eq('is_flagged', false);
  else if (filter === 'moderation') query = query.or('is_flagged.is.null,is_flagged.eq.true');
  const { data, error } = await query.order('created_at', { ascending: false }).limit(ADMIN_REVIEW_LIST_LIMIT);
  if (error || !Array.isArray(data)) {
    return serverError('admin-reviews-list', error ?? new Error('ADMIN_REVIEWS_UNCONFIRMED'), ROUTE, '口コミを読み込めませんでした');
  }

  const { states, error: moderationError } = await readReviewModeration(createServiceRoleClient(), data);
  if (moderationError) {
    return serverError('admin-reviews-moderation', moderationError, ROUTE, '口コミの審査状態を確認できませんでした');
  }
  // status が 'published' 以外（NULL を含む）は公開ビューに出ないので「非表示」として見せる。
  const reviews: AdminReview[] = data.map((row, i) => ({
    id: row.id,
    reviewer_name: row.reviewer_name,
    rating: row.rating,
    comment: row.comment,
    status: row.status === 'published' ? 'published' : 'hidden',
    created_at: row.created_at,
    moderation: states[i],
  }));
  return NextResponse.json({ reviews }, { headers });
}

export const GET = withRoute(list, {
  csrf: false, requireAuth: true,
  rateLimit: { limiter: null, limit: 60, windowMs: 60_000, prefix: 'admin-reviews-list' },
  sentryTag: 'admin-reviews-list',
});
