import { createServerSupabaseClient } from './supabase-server';
import type { FacilityCardData } from '@/types';

export async function getRankedFacilities(prefecture?: string, limit = 20): Promise<FacilityCardData[]> {
  const supabase = createServerSupabaseClient();
  let query = supabase
    .from('facility_profiles')
    .select('id, slug, name, business_type, catch_copy, prefecture, city, access_info, rating_avg, rating_count, main_photo_url')
    .eq('status', 'published')
    .gt('rating_count', 0)
    // 【2026年7月8日 恒久根治】主キー(id)を二次キーとして追加する。PostgreSQLは単一列ORDER BYで
    // 同値行の順序を保証しないため、rating_avgが同点の施設が「1位/2位/3位」の順位バッジ表示で
    // ISR再生成(revalidate=3600)のたびに入れ替わりうる。idを二次キーにし、同点内の順序を
    // 常に決定的にする（詳細は src/lib/facilities.ts の searchFacilities のコメント参照）。
    .order('rating_avg', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit);

  if (prefecture) query = query.eq('prefecture', prefecture);

  const { data } = await query;
  return (data ?? []) as FacilityCardData[];
}
