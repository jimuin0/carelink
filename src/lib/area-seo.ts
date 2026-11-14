import { createServerSupabaseClient } from './supabase-server';
import { businessTypeLabel } from './business-type-label';

interface FaqItem {
  question: string;
  answer: string;
}

export interface AreaSeoContent {
  h2_title: string | null;
  body_text: string;
  faq_items: FaqItem[];
}

/** Index a region × business-type page only when it has inventory and original decision material. */
export function isIndexableAreaQuality(
  facilityCount: number | null | undefined,
  content: { h2: string; intro: string; highlights: readonly string[]; faqs: readonly FaqItem[] } | null,
): boolean {
  if (facilityCount === null || facilityCount === undefined || facilityCount < 1 || content === null) return false;
  const textLength = [content.h2, content.intro, ...content.highlights, ...content.faqs.flatMap((faq) => [faq.question, faq.answer])]
    .join('')
    .trim().length;
  return content.h2.trim().length >= 10
    && content.intro.trim().length >= 120
    && content.highlights.length >= 2
    && content.faqs.length >= 2
    && textLength >= 300;
}

// 読めなかった（DB 障害）を「その段の文言なし」と区別する。握り潰すと、より汎用な文言や
// 文言なしのページが 1 時間 ISR に載る（呼び出し元のページは例外を error.tsx の一時障害表示にする・B4-5）。
function areaSeoReadError(cause: unknown): Error {
  return new Error('area_seo_contents read failed', { cause });
}

/**
 * エリアSEOコンテンツ取得（フォールバックチェーン付き）
 *
 * 優先順位:
 * 1. prefecture + city + type（最も具体的）
 * 2. prefecture + city（市区町村汎用）
 * 3. prefecture + type（業種汎用）
 * 4. prefecture（最も汎用）
 */
export async function getAreaSeoContent(
  prefectureSlug: string,
  citySlug?: string | null,
  businessTypeSlug?: string | null
): Promise<AreaSeoContent | null> {
  const supabase = createServerSupabaseClient();

  // 1. 最も具体的なマッチを試行
  if (citySlug && businessTypeSlug) {
    const { data, error } = await supabase
      .from('area_seo_contents')
      .select('h2_title, body_text, faq_items')
      .eq('prefecture_slug', prefectureSlug)
      .eq('city_slug', citySlug)
      .eq('business_type_slug', businessTypeSlug)
      .maybeSingle();
    if (error) throw areaSeoReadError(error);
    if (data) return toSeoContent(data);
  }

  // 2. 市区町村汎用
  if (citySlug) {
    const { data, error } = await supabase
      .from('area_seo_contents')
      .select('h2_title, body_text, faq_items')
      .eq('prefecture_slug', prefectureSlug)
      .eq('city_slug', citySlug)
      .is('business_type_slug', null)
      .maybeSingle();
    if (error) throw areaSeoReadError(error);
    if (data) return toSeoContent(data);
  }

  // 3. 業種汎用
  if (businessTypeSlug) {
    const { data, error } = await supabase
      .from('area_seo_contents')
      .select('h2_title, body_text, faq_items')
      .eq('prefecture_slug', prefectureSlug)
      .is('city_slug', null)
      .eq('business_type_slug', businessTypeSlug)
      .maybeSingle();
    if (error) throw areaSeoReadError(error);
    if (data) return toSeoContent(data);
  }

  // 4. 都道府県汎用
  const { data, error } = await supabase
    .from('area_seo_contents')
    .select('h2_title, body_text, faq_items')
    .eq('prefecture_slug', prefectureSlug)
    .is('city_slug', null)
    .is('business_type_slug', null)
    .maybeSingle();
  if (error) throw areaSeoReadError(error);
  if (data) return toSeoContent(data);

  return null;
}

function toSeoContent(data: { h2_title: string | null; body_text: string; faq_items: unknown }): AreaSeoContent {
  return {
    h2_title: data.h2_title,
    body_text: data.body_text,
    faq_items: (data.faq_items as FaqItem[]) || [],
  };
}

/**
 * SEOテキスト内のテンプレート変数を実データで置換
 * {{facility_count}}, {{avg_rating}}, {{area_name}} 等を動的に注入
 */
export async function enrichSeoContent(
  content: AreaSeoContent,
  prefectureName: string,
  cityName?: string | null,
  businessType?: string | null,
): Promise<AreaSeoContent> {
  const supabase = createServerSupabaseClient();

  let query = supabase.from('facility_profiles').select('rating_avg', { count: 'exact', head: false }).eq('prefecture', prefectureName);
  if (cityName) query = query.eq('city', cityName);
  if (businessType) query = query.eq('business_type', businessType);
  const { data: facilities, count, error } = await query;
  // 読み取り失敗を「掲載0件」「—」として本文に書き込まない（点検 A51）。
  if (error) throw new Error(`[area-seo] enrichSeoContent failed: ${error.message}`);

  const facilityCount = count ?? 0;
  // 評価の無い施設（rating_avg=null）を0点として平均に入れると実際より低く出るため除く（点検 A51）。
  const rated = (facilities ?? []).filter((f) => typeof f.rating_avg === 'number');
  const avgRating = rated.length > 0
    ? (rated.reduce((sum, f) => sum + (f.rating_avg as number), 0) / rated.length).toFixed(1)
    : '—';
  const areaName = cityName ? `${prefectureName}${cityName}` : prefectureName;

  const replacements: Record<string, string> = {
    '{{facility_count}}': String(facilityCount),
    '{{avg_rating}}': avgRating,
    '{{area_name}}': areaName,
    '{{business_type}}': businessTypeLabel(businessType) || 'サロン・クリニック',
  };

  const replace = (text: string) =>
    Object.entries(replacements).reduce((t, [key, val]) => t.replaceAll(key, val), text);

  return {
    h2_title: content.h2_title ? replace(content.h2_title) : null,
    body_text: replace(content.body_text),
    faq_items: content.faq_items.map((item) => ({
      question: replace(item.question),
      answer: replace(item.answer),
    })),
  };
}
