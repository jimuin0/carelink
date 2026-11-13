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

/**
 * 公開中の特集を読む。失敗（error・タイムアウト）は例外にする。
 * ISR ページはこれを使い、障害時に「準備中・noindex」を1時間キャッシュさせない（直前の正常版が残る）。
 */
export async function getPublishedFeaturesStrict(limit = 10): Promise<Feature[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await withTimeout(
    supabase
      .from('features')
      .select('id, title, slug, description, banner_image_url, filter_type, filter_keyword, filter_prefecture, display_order, published_at')
      .eq('is_published', true)
      .order('display_order', { ascending: true })
      .limit(limit),
    FEATURE_QUERY_TIMEOUT_MS,
  );
  if (error) throw new Error(error.message);
  return (data || []) as Feature[];
}

/** 失敗時は [] を返す版（generateStaticParams など、失敗でビルドを止めたくない箇所用）。 */
export async function getPublishedFeatures(limit = 10): Promise<Feature[]> {
  try {
    return await getPublishedFeaturesStrict(limit);
  } catch (error) {
    console.error(
      '[features] getPublishedFeatures failed:',
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

/**
 * 公開中の特集を slug で 1 件引く。見つからなければ null。DB 障害は例外にする（中 A52）。
 * slug になり得ない入力は問い合わせずに「見つからない」にする（誰でも 5xx と障害通知を出せないように）。
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
  // 読み取り失敗を「特集が無い（404）」にしない。例外にして error.tsx／直前のキャッシュに委ねる。
  if (error) throw new Error(`[features] getFeatureBySlug failed: ${error.message}`);
  return data as Feature | null;
}
