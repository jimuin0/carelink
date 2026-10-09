import type { SupabaseClient } from '@supabase/supabase-js';

/** LINE sends require a current profile and server-verified ownership. Older
 * self-editable profile/legacy NULL link values alone never authorize a send.
 */
export async function resolveLineUserIdForUser(client: SupabaseClient, userId: string): Promise<string | null> {
  const { data: profile, error } = await client.from('profiles').select('line_user_id').eq('id', userId).maybeSingle();
  if (error) throw new Error('LINE profile lookup unavailable');
  if (!profile?.line_user_id) return null;
  const { data: link, error: linkError } = await client.from('line_user_links')
    .select('user_id, line_user_id, proof_version, verified_at').eq('user_id', userId).maybeSingle();
  if (linkError) throw new Error('LINE ownership lookup unavailable');
  return link?.user_id === userId && link.line_user_id === profile.line_user_id && link.proof_version === 1 &&
    typeof link.verified_at === 'string' && Number.isFinite(Date.parse(link.verified_at)) ? link.line_user_id : null;
}

export async function resolveLineUserIdsForUsers(client: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  if (!userIds.length) return resolved;
  const profiles = await client.from('profiles').select('id, line_user_id').in('id', userIds);
  if (profiles.error) throw new Error('LINE profile lookup unavailable');
  const links = await client.from('line_user_links').select('user_id, line_user_id, proof_version, verified_at').in('user_id', userIds);
  if (links.error) throw new Error('LINE ownership lookup unavailable');
  const byUser = new Map((profiles.data ?? []).map(p => [p.id, p.line_user_id]));
  for (const link of links.data ?? []) {
    if (link.user_id && link.line_user_id && byUser.get(link.user_id) === link.line_user_id && link.proof_version === 1 && typeof link.verified_at === 'string' && Number.isFinite(Date.parse(link.verified_at))) {
      resolved.set(link.user_id, link.line_user_id);
    }
  }
  return resolved;
}
