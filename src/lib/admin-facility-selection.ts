import type { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { UUID_REGEX } from '@/lib/constants';

export type AdminFacilityChoice = { id: string; name: string };

// Shared by server pages and client editors. A missing selection is not an
// instruction to choose an arbitrary tenant when several memberships exist.
export async function loadAdminFacilitySelection(
  db: ReturnType<typeof createBrowserSupabaseClient>, userId: string, requested: string | null,
) {
  if (requested !== null && !UUID_REGEX.test(requested)) throw new Error('invalid_facility_selection');
  const { data, error } = await db.from('facility_members')
    .select('facility_id, facility_profiles(name)').eq('user_id', userId)
    .in('role', ['owner', 'admin']).order('facility_id').limit(101);
  if (error || !Array.isArray(data) || data.length > 100) throw new Error('facility_selection_unavailable');
  const choices: AdminFacilityChoice[] = data.map(row => {
    const profile = row.facility_profiles as unknown as { name: string } | null;
    return { id: row.facility_id, name: profile?.name || '名称未設定の店舗' };
  });
  const selected = requested === null
    ? (choices.length === 1 ? choices[0] : null)
    : choices.find(choice => choice.id === requested);
  if (requested !== null && !selected) throw new Error('unauthorized_facility_selection');
  return { choices, selectedId: selected?.id ?? null };
}
