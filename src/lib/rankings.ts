import { createServerSupabaseClient } from './supabase-server';
import type { FacilityCardData } from '@/types';

export async function getRankedFacilities(prefecture?: string, limit = 20): Promise<FacilityCardData[]> {
  const supabase = createServerSupabaseClient();
  let query = supabase
    .from('facility_profiles')
    .select('id, slug, name, business_type, catch_copy, prefecture, city, access_info, rating_avg, rating_count, main_photo_url')
    .eq('status', 'published')
    .gt('rating_count', 0)
    .order('rating_avg', { ascending: false })
    .limit(limit);

  if (prefecture) query = query.eq('prefecture', prefecture);

  const { data } = await query;
  return (data ?? []) as FacilityCardData[];
}
