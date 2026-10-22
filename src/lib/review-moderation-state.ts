import type { createServiceRoleClient } from './supabase-server';

/**
 * 運営の審査から見た口コミの状態（2026年10月23日 新設）。
 * 店舗の口コミ管理（/api/admin/reviews）と投稿者のマイページ（/api/review/mine）が同じ判定を使う。
 *
 * - 'none'     … 審査で止められていない（status だけで公開・非表示が決まる）
 * - 'pending'  … 運営の確認中。確認が終わるまで店舗ページにも評価にも出ない
 * - 'rejected' … 運営の判断で非公開。店舗が「公開する」を押しても公開されない
 * - 'stalled'  … 最新の審査は承認なのに旗が立ったまま（審査待ちの行も無い）。運営の審査画面にも出ず、
 *                承認をやり直す操作も拒まれる（moderate_review_content_atomic の REVISION_CONFLICT）ので、
 *                『確認中』と案内すると事実と異なる。運営への問い合わせを案内する。
 *                星だけの編集で承認済みの口コミに旗が戻っていた不具合（migration 20261023120000 で修正）で
 *                できた行がこれに当たる。件数は scripts/diagnose-review-approved-but-flagged.sql で数える。
 *
 * 【なぜ要るか】公開ページ（public_reviews）と評価の集計（update_facility_rating）は
 * is_flagged=false の口コミだけを数える。以前の店舗画面は status だけを見ていたので、
 * 審査待ちや運営が却下した口コミにも『公開中』を出し、『公開する』を押すと
 * 「公開しました」と出るのに実際には公開されなかった。
 * 審査待ちか却下済みかは moderation_queue にしか無く、店舗・投稿者のロールはその表を読めない
 * （運営だけが読める）ので、サーバー（service_role）がここで判定して状態だけを返す。
 */
export type ReviewModeration = 'none' | 'pending' | 'rejected' | 'stalled';

export type ModerationQueueRow = { content_id: string; status: string; created_at: string };

/**
 * is_flagged が false 以外（true・NULL）なら公開されない。公開ビューと集計の条件
 * （is_flagged = false）に合わせ、NULL も審査で止められている側に倒す。
 * - 未決（pending / escalated）の審査がある → 'pending'
 * - 最新の審査が却下（rejected）→ 'rejected'
 * - 最新の審査が承認（approved）なのに旗が立っている → 'stalled'
 * - 審査の行が無い → 'pending'
 *   （どれも公開されていない理由が運営側にあるので、店舗に「公開する」を押させない）
 */
export function reviewModeration(isFlagged: boolean | null, rows: readonly ModerationQueueRow[]): ReviewModeration {
  if (isFlagged === false) return 'none';
  if (rows.some((row) => row.status === 'pending' || row.status === 'escalated')) return 'pending';
  const latest = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (latest?.status === 'rejected') return 'rejected';
  return latest?.status === 'approved' ? 'stalled' : 'pending';
}

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/**
 * 口コミ群の審査状態をまとめて読む。返す配列は reviews と同じ順・同じ長さ。
 * 旗の立っていない口コミは表を読まずに 'none'。読めなかったときは error を返す
 * （推測の状態を「公開中」として見せない）。
 * 呼び出し側で、その口コミを見てよい人（店舗の owner / admin・投稿者本人）だと確かめてから渡すこと。
 */
export async function readReviewModeration(
  db: ServiceClient, reviews: readonly { id: string; is_flagged: boolean | null }[],
): Promise<{ states: ReviewModeration[]; error: unknown }> {
  const flagged = reviews.filter((review) => review.is_flagged !== false).map((review) => review.id);
  if (flagged.length === 0) return { states: reviews.map(() => 'none' as const), error: null };
  const { data, error } = await db.from('moderation_queue')
    .select('content_id, status, created_at')
    .eq('content_type', 'review')
    .in('content_id', flagged);
  if (error || !Array.isArray(data)) return { states: [], error: error ?? new Error('MODERATION_STATE_UNCONFIRMED') };
  return {
    states: reviews.map((review) => reviewModeration(review.is_flagged, data.filter((row) => row.content_id === review.id))),
    error: null,
  };
}
