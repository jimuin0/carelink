import { createServerSupabaseClient } from './supabase-server';
import type { TreatmentCatalog } from '@/types';

export async function getCatalogsByFacility(facilityId: string): Promise<TreatmentCatalog[]> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('treatment_catalogs')
    .select('*')
    .eq('facility_id', facilityId)
    .order('created_at', { ascending: false });
  return (data ?? []) as TreatmentCatalog[];
}
