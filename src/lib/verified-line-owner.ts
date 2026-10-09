import type { SupabaseClient } from '@supabase/supabase-js';

/** A self-editable profile alone is not proof of a LINE account binding.
 * Legacy unowned links stay unowned until a verified linking request succeeds.
 */
export async function resolveVerifiedLineOwner(client: SupabaseClient, lineUserId: string): Promise<string | null> {
  const { data: profile, error: profileError } = await client.from('profiles')
    .select('id').eq('line_user_id', lineUserId).maybeSingle();
  if (profileError) throw new Error('LINE profile lookup unavailable');
  if (!profile || typeof profile.id !== 'string' || !profile.id) return null;
  const { data: link, error: linkError } = await client.from('line_user_links')
    .select('user_id, proof_version, verified_at').eq('line_user_id', lineUserId).eq('user_id', profile.id).maybeSingle();
  if (linkError) throw new Error('LINE ownership lookup unavailable');
  return link?.user_id === profile.id && link.proof_version === 1 && typeof link.verified_at === 'string' && Number.isFinite(Date.parse(link.verified_at))
    ? profile.id : null;
}
