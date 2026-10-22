import { createServerSupabaseClient } from './supabase-server';

/**
 * 症状ページ（/symptom/[slug]）と症状チェッカーを検索エンジンへ出してよいかの判定材料
 * （2026年10月22日 新設・神原さん決定「施設が載るまで検索に出さない」）。
 *
 * 【何が起きていたか（本番実測）】
 * 対応症状（facility_symptoms）を施設が登録する管理画面・API はアプリに 1 本も無く、本番は 0 行。
 * そのため症状ページ 30 本は全て「対応可能な施設は登録されていません」の空表示で、
 * 症状チェッカーはどの症状を選んでも「0件」になる。それなのに sitemap.xml には 31 本とも
 * 無条件で載り、noindex も無かった（sitemap 60 URL の半分強）。
 *
 * 判定は必ず「公開中の施設と結びついた行があるか」で行う。行の有無だけで見ると、
 * 非公開・下書きの施設に結びついた症状まで「施設が載っている」と扱ってしまう。
 */

/**
 * 公開中の施設が 1 件以上結びついている症状の slug。
 *
 * 症状マスタ（30 行）側から引き、対応表と施設を内部結合で絞り込む。対応表側から引くと
 * 施設×症状の行数ぶん返り、API の行数上限で途中から切れて症状が欠ける。
 * 埋め込みは列を返さない空の埋め込みにし、絞り込みだけに使う（検索の症状条件 detailFilter と同じ形）。
 * 読み取りに失敗したら例外にする（「0 件」と取り違えて全ページを外す／出すことを防ぐ。
 * どちらに倒すかは呼び出し側が決める）。
 */
export async function getSymptomSlugsWithPublishedFacilities(): Promise<Set<string>> {
  const { data, error } = await createServerSupabaseClient()
    .from('symptoms')
    .select('slug, facility_symptoms!inner(facility_profiles!inner())')
    .eq('facility_symptoms.facility_profiles.status', 'published');
  if (error || !Array.isArray(data)) throw new Error('Symptom coverage unavailable');
  return new Set(data.map((row) => row.slug));
}
