import type { ReviewModeration } from './review-moderation-state';

/**
 * 店舗の口コミ管理画面（/admin/reviews）と一覧 API（/api/admin/reviews）が共有する定義。
 * route.ts は HTTP メソッド以外を export できないので、ここに置く。
 *
 * 絞り込み:
 * - all        … すべて
 * - published  … 公開中（店舗ページに実際に出ているもの＝status が公開で、運営の審査で止められていない）
 * - hidden     … 店舗が非表示にしたもの（運営の審査で止められていない）
 * - moderation … 運営の確認中・運営判断で非公開（status に関係なく）
 */
export const ADMIN_REVIEW_FILTERS = ['all', 'published', 'hidden', 'moderation'] as const;
export type AdminReviewFilter = (typeof ADMIN_REVIEW_FILTERS)[number];

/** 1 回に返す件数（従来の画面と同じ）。 */
export const ADMIN_REVIEW_LIST_LIMIT = 100;

/**
 * 画面に出す列だけ。投稿者の IP アドレス・アカウント ID・予約 ID は含めない
 * （店舗が投稿者を特定できないようにする。列権限は migration 20261023120100）。
 */
export type AdminReview = {
  id: string;
  reviewer_name: string;
  rating: number;
  comment: string | null;
  status: 'published' | 'hidden';
  created_at: string | null;
  moderation: ReviewModeration;
};
