import { createServerSupabaseClient } from './supabase-server';
import type { FacilityCardData } from '@/types';

const RANKING_QUERY_TIMEOUT_MS = 5_000;

async function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`ranking query timeout ${ms}ms`)),
      ms,
    );
  });

  try {
    return await Promise.race([
      Promise.resolve(promise),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function getRankedFacilities(
  prefecture?: string,
  limit = 20,
): Promise<FacilityCardData[]> {
  const supabase = createServerSupabaseClient();

  let query = supabase
    .from('facility_profiles')
    .select(
      'id, slug, name, business_type, catch_copy, prefecture, city, access_info, rating_avg, rating_count, main_photo_url',
    )
    .eq('status', 'published')
    .gt('rating_count', 0)
    .order('rating_avg', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit);

  if (prefecture) {
    query = query.eq('prefecture', prefecture);
  }

  try {
    const { data, error } = await withTimeout(
      query,
      RANKING_QUERY_TIMEOUT_MS,
    );

    if (error) {
      console.error('[rankings] getRankedFacilities failed:', error.message);
      return [];
    }

    return (data ?? []) as FacilityCardData[];
  } catch (error) {
    console.error(
      '[rankings] getRankedFacilities failed:',
      error instanceof Error ? error.message : String(error),
    );

    return [];
  }
}