import { createServerSupabaseClient } from './supabase-server';
import type { TreatmentCatalog } from '@/types';

export async function getCatalogsByFacility(facilityId: string): Promise<TreatmentCatalog[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('treatment_catalogs')
    .select('*')
    .eq('facility_id', facilityId)
    .order('created_at', { ascending: false });
  // 取得失敗を「カタログ0件」と区別できるよう throw する（blog.ts・coupons.ts と同じ・低 A212）。
  if (error) throw new Error(`[catalogs] getCatalogsByFacility failed: ${error.message}`);
  return (data ?? []) as TreatmentCatalog[];
}
