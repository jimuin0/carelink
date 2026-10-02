import type { createServiceRoleClient } from './supabase-server';
import { duplicateLinkInput, duplicateLinkResponse } from './registration-duplicate-contract';

export async function linkDuplicateRegistration(db: ReturnType<typeof createServiceRoleClient>, actor: string, value: unknown) {
  const parsed = duplicateLinkInput.safeParse(value);
  if (!parsed.success) return { outcome: 'invalid' as const };
  const input = parsed.data;
  const result = await db.rpc('link_duplicate_registration', {
    p_actor: actor, p_duplicate: input.duplicateId, p_canonical: input.canonicalId,
    p_commit: input.action === 'link',
    p_duplicate_revision: input.action === 'link' ? input.duplicateRevision : -1,
    p_canonical_revision: input.action === 'link' ? input.canonicalRevision : -1,
    p_same_site: input.action === 'link',
  });
  const response = duplicateLinkResponse.safeParse(result.data);
  if (result.error !== null || !response.success) throw new Error('Registration linkage result unavailable');
  if (response.data.outcome === 'preview' && (input.action !== 'preview'
    || response.data.duplicateId !== input.duplicateId || response.data.canonicalId !== input.canonicalId)) {
    throw new Error('Registration linkage result mismatch');
  }
  if (input.action === 'preview' && response.data.outcome === 'linked') throw new Error('Unexpected linkage mutation');
  return response.data;
}
