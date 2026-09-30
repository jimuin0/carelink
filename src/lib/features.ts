import { createServerSupabaseClient } from './supabase-server';

const FEATURE_QUERY_TIMEOUT_MS = 5_000;

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

async function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;

  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`features query timeout ${ms}ms`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function getPublishedFeatures(limit = 10): Promise<Feature[]> {
  const supabase = createServerSupabaseClient();

  try {
    const { data, error } = await withTimeout(
      supabase
        .from('features')
        .select('id, title, slug, description, banner_image_url, filter_type, filter_keyword, filter_prefecture, display_order, published_at')
        .eq('is_published', true)
        .order('display_order', { ascending: true })
        .limit(limit),
      FEATURE_QUERY_TIMEOUT_MS,
    );

    if (error) {
      console.error('[features] getPublishedFeatures failed:', error.message);
      return [];
    }

    return (data || []) as Feature[];
  } catch (error) {
    console.error(
      '[features] getPublishedFeatures failed:',
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
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
