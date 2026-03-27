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
