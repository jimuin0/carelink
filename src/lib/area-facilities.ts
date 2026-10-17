import { createServerSupabaseClient } from './supabase-server';
import { CARD_COLS } from './facilities';
import type { AreaSearchScope } from './areas';
import type { FacilityCardData } from '@/types';

const PER_PAGE = 20;

/** Scoped area search; not the GPS/description-keyword search contract. */
export async function searchAreaFacilities(scope: AreaSearchScope, page: number) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new Error('Invalid area search page');
  if (scope.kind === 'region' && scope.prefectures.length === 0) {
    return { facilities: [] as FacilityCardData[], total: 0, perPage: PER_PAGE };
  }
  const supabase = createServerSupabaseClient();
  const scopedQuery = (head = false) => {
    let query = supabase.from('facility_card_view').select(CARD_COLS, { count: 'exact', ...(head ? { head: true } : {}) }).eq('status', 'published');
    if (scope.kind === 'region') query = query.in('prefecture', scope.prefectures);
    else {
      query = query.eq('prefecture', scope.prefecture);
      if (scope.kind === 'city') query = query.eq('city', scope.city);
      if (scope.kind === 'station') {
        if (scope.city) query = query.eq('city', scope.city);
        // nearest_station is free text. The UI explicitly describes containment,
        // not verified station membership (e.g. 本町駅 can match 堺筋本町駅).
        query = query.ilike('nearest_station', `%${scope.station.replace(/[%_\\]/g, '\\$&')}%`);
      }
    }
    return query;
  };
  const from = (page - 1) * PER_PAGE;
  const { data, count, error, status } = await scopedQuery().order('rating_avg', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true }).range(from, from + PER_PAGE - 1);
  // PostgREST returns 416/PGRST103 (and no decoded count) when the requested
  // offset exceeds the matching rows. Confirm the current count using the same
  // geography/publication filters; never reinterpret an arbitrary DB failure as 0.
  if (status === 416 && error?.code === 'PGRST103' && from > 0) {
    const { count: currentCount, error: countError } = await scopedQuery(true);
    if (countError || !Number.isSafeInteger(currentCount) || currentCount! < 0 || from < currentCount!) {
      throw new Error('Area facilities unavailable');
    }
    return { facilities: [] as FacilityCardData[], total: currentCount!, perPage: PER_PAGE };
  }
  if (error || !Array.isArray(data) || !Number.isSafeInteger(count) || count! < data.length) throw new Error('Area facilities unavailable');
  return { facilities: data as unknown as FacilityCardData[], total: count!, perPage: PER_PAGE };
}
