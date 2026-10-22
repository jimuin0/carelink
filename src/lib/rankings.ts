import { cache } from 'react';
import { createServerSupabaseClient } from './supabase-server';
import { databaseDiagnostic } from './database-diagnostic';
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

/**
 * 口コミ評価順のランキング（口コミのある公開施設だけ）。
 *
 * 【2026年10月22日 是正】以前は読み取り失敗・タイムアウトでも [] を返しており、ページ側は
 * 「まだ口コミが集まっていません」と区別できなかった。空のランキングを noindex にするには
 * 「本当に 0 件」と「読めなかった」を分ける必要があるため、失敗は例外にする
 * （ページは error.tsx の一時障害表示になり、障害中の空ページに noindex を付けて残さない）。
 * metadata と本文が同じ結果を使うので、同じリクエスト内では cache で 1 回にまとめる。
 */
export const getRankedFacilities = cache(async (
  prefecture?: string,
  limit = 20,
): Promise<FacilityCardData[]> => {
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

    // DB のメッセージは利用者入力や内部情報を含みうるので、コードだけを残す。
    if (error) throw databaseDiagnostic(error);

    return (data ?? []) as FacilityCardData[];
  } catch (error) {
    console.error(
      '[rankings] getRankedFacilities failed:',
      error instanceof Error ? error.message : String(error),
    );

    throw new Error('RANKING_UNAVAILABLE');
  }
});