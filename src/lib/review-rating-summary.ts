import type { createServiceRoleClient } from './supabase-server';
import { fetchAllPaged } from './paginate';

/**
 * 口コミ評価の集計（ホットペッパービューティー型＝総合＋項目別の平均点・2026年10月22日 新設）。
 *
 * 【神原さん決定（2026年10月22日）】「ホットペッパーみたいな評価の付け方にしたら？」
 * 以前の /admin/usage-stats の「NPS スコア」と /admin/chain の「NPS」列は nps_surveys を
 * 集計していたが、来院者が NPS に答える画面・メール・LIFF がどこにも無く、
 * 1 行も入らないまま常に空だった。口コミ（facility_reviews）は投稿時に総合と 5 項目を
 * 必ず付けてもらっているので、それを店舗ごとに集計して出す。
 *
 * 数えるのは【公開中の口コミだけ】（status='published' かつ is_flagged=false）。
 * 施設の rating_avg / rating_count を更新するトリガ update_facility_rating() と同じ条件にして、
 * 公開ページの評価と管理画面の評価が食い違わないようにする。施設自体が下書き・停止中でも
 * 店舗の管理画面では自店の評価を見られる（public_reviews は施設が公開中のものしか返さない）。
 *
 * 平均は小数 1 桁（四捨五入）。DB の ROUND(AVG(rating)::numeric, 1) と同じ値になるよう、
 * 合計と件数（どちらも整数）から計算して浮動小数の誤差で .x5 の丸めがずれないようにする。
 */

/** 項目名は口コミ投稿フォーム（src/components/facility/ReviewForm.tsx）の表示と同じ。 */
export const REVIEW_RATING_ITEMS = [
  { key: 'rating_skill', label: '技術' },
  { key: 'rating_service', label: '接客' },
  { key: 'rating_atmosphere', label: '雰囲気' },
  { key: 'rating_cleanliness', label: '清潔感' },
  { key: 'rating_explanation', label: '施術の説明' },
] as const;

export type ReviewRatingKey = (typeof REVIEW_RATING_ITEMS)[number]['key'];

export type ReviewRatingRow = { facility_id: string; rating: number | null } & { [K in ReviewRatingKey]: number | null };

export type ReviewRatingItem = { key: ReviewRatingKey; label: string; average: number | null; count: number };

export type ReviewRatingSummary = {
  /** 公開中の口コミの件数 */
  count: number;
  /** 総合評価の平均（小数 1 桁）。口コミが 0 件なら null */
  overall: number | null;
  /** 項目別の平均。項目を付けていない古い口コミは、その項目の母数に入れない */
  items: ReviewRatingItem[];
};

const COLUMNS = 'facility_id, rating, rating_skill, rating_service, rating_atmosphere, rating_cleanliness, rating_explanation';

/** 1〜5 の整数だけを評価として数える（DB の CHECK と同じ範囲。想定外の値で平均を歪めない）。 */
function score(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round((sum * 10) / values.length) / 10;
}

export function summarizeReviewRatings(rows: readonly ReviewRatingRow[]): ReviewRatingSummary {
  const overall = rows.map((row) => score(row.rating)).filter((value): value is number => value !== null);
  return {
    count: rows.length,
    overall: average(overall),
    items: REVIEW_RATING_ITEMS.map(({ key, label }) => {
      const values = rows.map((row) => score(row[key])).filter((value): value is number => value !== null);
      return { key, label, average: average(values), count: values.length };
    }),
  };
}

/** 平均点の表示（小数 1 桁）。その項目の評価がまだ無いときは「—」。 */
export function formatReviewAverage(value: number | null): string {
  return value === null ? '—' : value.toFixed(1);
}

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

function publishedReviews(db: ServiceClient) {
  return db.from('facility_reviews').select(COLUMNS).eq('status', 'published').eq('is_flagged', false);
}

/**
 * 1 店舗分。呼び出し側で所属（owner/admin）を確かめた店舗 ID だけを渡すこと（service role で読むため）。
 * PostgREST の max_rows（1000 行）で黙って打ち切られないよう全件をページングで読み、
 * 読み切れないときは error を返す（部分的な平均を「実測」として出さない）。
 */
export async function readFacilityReviewRatings(
  db: ServiceClient, facilityId: string,
): Promise<{ summary: ReviewRatingSummary; error: unknown }> {
  const { rows, error } = await fetchAllPaged<ReviewRatingRow>(async (offset, limit) => {
    const { data, error: pageError } = await publishedReviews(db).eq('facility_id', facilityId)
      .order('id', { ascending: true }).range(offset, offset + limit - 1);
    return { data, error: pageError };
  }, { failOnTruncation: true });
  return { summary: summarizeReviewRatings(rows), error };
}

/** 複数店舗分（/admin/chain）。口コミが 0 件の店舗も「0 件」として必ず返す。 */
export async function readFacilitiesReviewRatings(
  db: ServiceClient, facilityIds: readonly string[],
): Promise<{ summaries: Map<string, ReviewRatingSummary>; error: unknown }> {
  const { rows, error } = await fetchAllPaged<ReviewRatingRow>(async (offset, limit) => {
    const { data, error: pageError } = await publishedReviews(db).in('facility_id', [...facilityIds])
      .order('id', { ascending: true }).range(offset, offset + limit - 1);
    return { data, error: pageError };
  }, { failOnTruncation: true });
  const summaries = new Map(facilityIds.map((id) => [id, summarizeReviewRatings(rows.filter((row) => row.facility_id === id))]));
  return { summaries, error };
}
