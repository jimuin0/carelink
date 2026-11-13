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

/**
 * 公開中の特集を slug で 1 件引く。見つからなければ null。
 * DB 障害は null（→ notFound で 404）に化けさせず例外にする（公開中の特集が 404 になり、通知も出ないため・中 A52）。
 * getFacilityBySlug と同じく、slug になり得ない入力は問い合わせずに「見つからない」にする
 * （そのまま渡すと DB が入力の誤りとして弾き、誰でも 5xx と障害通知を出せてしまう）。
 */
export async function getFeatureBySlug(slug: string): Promise<Feature | null> {
  if (slug.length === 0 || slug.length > 200 || /[\u0000-\u001f\u007f]/.test(slug)) return null;
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('features')
    .select('*')
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle();
  if (error) throw new Error('FEATURE_LOOKUP_FAILED', { cause: error });
  return data as Feature | null;
}
