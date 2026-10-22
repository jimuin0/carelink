import type { ReviewModeration } from './review-moderation-state';

/**
 * 投稿者本人の口コミ（/api/review/mine の応答・/mypage/reviews と編集画面が使う）。
 * route.ts は HTTP メソッド以外を export できないので、ここに置く。
 *
 * 以前のマイページはブラウザから facility_reviews を .eq('user_id', 自分) で読んでいた。
 * 店舗に投稿者のアカウント ID・IP アドレスを渡さないよう、migration 20261023120100 で
 * それらの列の閲覧権限をブラウザのロールから外したため、本人の口コミはサーバー（service_role）が
 * 本人の行だけを読んで返す。投稿者自身にも IP アドレスなどの内部の列は返さない。
 */
export type MyReview = {
  id: string;
  facility_name: string;
  facility_slug: string;
  rating: number;
  rating_skill: number | null;
  rating_service: number | null;
  rating_atmosphere: number | null;
  rating_cleanliness: number | null;
  rating_explanation: number | null;
  comment: string | null;
  status: 'published' | 'hidden';
  created_at: string | null;
  moderation: ReviewModeration;
};

/** 1 回に返す件数の上限（1 人の投稿としては十分に大きい値）。 */
export const MY_REVIEWS_LIMIT = 200;
