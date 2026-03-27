import { createServerSupabaseClient } from './supabase-server';

interface FaqItem {
  question: string;
  answer: string;
}

export interface AreaSeoContent {
  h2_title: string | null;
  body_text: string;
  faq_items: FaqItem[];
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
    const { data } = await supabase
      .from('area_seo_contents')
      .select('h2_title, body_text, faq_items')
      .eq('prefecture_slug', prefectureSlug)
      .eq('city_slug', citySlug)
      .eq('business_type_slug', businessTypeSlug)
      .maybeSingle();
    if (data) return toSeoContent(data);
  }

  // 2. 市区町村汎用
  if (citySlug) {
    const { data } = await supabase
      .from('area_seo_contents')
      .select('h2_title, body_text, faq_items')
      .eq('prefecture_slug', prefectureSlug)
      .eq('city_slug', citySlug)
      .is('business_type_slug', null)
      .maybeSingle();
    if (data) return toSeoContent(data);
  }

  // 3. 業種汎用
  if (businessTypeSlug) {
    const { data } = await supabase
      .from('area_seo_contents')
      .select('h2_title, body_text, faq_items')
      .eq('prefecture_slug', prefectureSlug)
      .is('city_slug', null)
      .eq('business_type_slug', businessTypeSlug)
      .maybeSingle();
    if (data) return toSeoContent(data);
  }

  // 4. 都道府県汎用
  const { data } = await supabase
    .from('area_seo_contents')
    .select('h2_title, body_text, faq_items')
    .eq('prefecture_slug', prefectureSlug)
    .is('city_slug', null)
    .is('business_type_slug', null)
    .maybeSingle();
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
  const { data: facilities, count } = await query;

  const facilityCount = count ?? 0;
  const avgRating = facilities && facilities.length > 0
    ? (facilities.reduce((sum, f) => sum + (f.rating_avg ?? 0), 0) / facilities.length).toFixed(1)
    : '—';
  const areaName = cityName ? `${prefectureName}${cityName}` : prefectureName;

  const replacements: Record<string, string> = {
    '{{facility_count}}': String(facilityCount),
    '{{avg_rating}}': avgRating,
    '{{area_name}}': areaName,
    '{{business_type}}': businessType || 'サロン・クリニック',
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
