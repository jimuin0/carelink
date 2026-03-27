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

export async function getAreaSeoContent(
  prefectureSlug: string,
  businessTypeSlug?: string | null
): Promise<AreaSeoContent | null> {
  const supabase = createServerSupabaseClient();
  let query = supabase
    .from('area_seo_contents')
    .select('h2_title, body_text, faq_items')
    .eq('prefecture_slug', prefectureSlug);

  if (businessTypeSlug) {
    query = query.eq('business_type_slug', businessTypeSlug);
  } else {
    query = query.is('business_type_slug', null);
  }

  const { data } = await query.maybeSingle();

  if (!data) {
    // business_type_slug指定時、都道府県全般のコンテンツにフォールバック
    if (businessTypeSlug) {
      const { data: fallback } = await supabase
        .from('area_seo_contents')
        .select('h2_title, body_text, faq_items')
        .eq('prefecture_slug', prefectureSlug)
        .is('business_type_slug', null)
        .maybeSingle();
      if (fallback) {
        return {
          h2_title: fallback.h2_title,
          body_text: fallback.body_text,
          faq_items: (fallback.faq_items as FaqItem[]) || [],
        };
      }
    }
    return null;
  }

  return {
    h2_title: data.h2_title,
    body_text: data.body_text,
    faq_items: (data.faq_items as FaqItem[]) || [],
  };
}
