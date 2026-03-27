import { createServerSupabaseClient } from './supabase-server';

export interface Feature {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  content: { heading: string; body: string }[] | null;
  banner_image_url: string | null;
  filter_type: string | null;
  filter_keyword: string | null;
  filter_prefecture: string | null;
  display_order: number;
  published_at: string | null;
}

export async function getPublishedFeatures(limit = 10): Promise<Feature[]> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('features')
    .select('id, title, slug, description, banner_image_url, filter_type, filter_keyword, filter_prefecture, display_order, published_at')
    .eq('is_published', true)
    .order('display_order', { ascending: true })
    .limit(limit);
  return (data || []) as Feature[];
}

export async function getFeatureBySlug(slug: string): Promise<Feature | null> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('features')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle();
  return data as Feature | null;
}
