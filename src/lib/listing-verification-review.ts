import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { hasListingEvidenceSignature, listingEvidenceInputSchema, listingEvidencePath } from './listing-verification-evidence';

export const listingFacilityIdentity = z.object({ name:z.string().nullable(),prefecture:z.string().nullable(),
  city:z.string().nullable(),address:z.string().nullable() }).strict();
const inputSchema = z.object({ actorId:z.uuid(),facilityId:z.uuid(),
  documentIds:z.array(z.uuid()).min(1).max(5).refine(ids => new Set(ids).size === ids.length),
  expectedIdentity:listingFacilityIdentity,
  documentVerified:z.literal(true),authorityVerified:z.literal(true) }).strict();
const documentSchema = z.object({ id:z.uuid(),facility_id:z.uuid(),object_path:z.string(),
  document_type:z.string(),mime_type:z.string(),byte_size:z.number(),sha256:z.string().regex(/^[a-f0-9]{64}$/) }).strict();

/** Server-only read, callable after platform authorization. Never log file bytes. */
export async function readListingEvidence(db: SupabaseClient, facilityId: string, documentId: string) {
  if (!z.uuid().safeParse(facilityId).success || !z.uuid().safeParse(documentId).success) return { state:'invalid' as const };
  try {
    const lookup = await db.from('listing_verification_documents')
      .select('id,facility_id,object_path,document_type,mime_type,byte_size,sha256')
      .eq('id',documentId).eq('facility_id',facilityId).maybeSingle();
    if (lookup.error !== null) return { state:'unavailable' as const };
    if (lookup.data === null) return { state:'not_found' as const };
    const checked = documentSchema.safeParse(lookup.data);
    if (!checked.success) return { state:'unavailable' as const };
    const doc = checked.data;
    if (doc.id !== documentId.toLowerCase() || doc.facility_id !== facilityId.toLowerCase()
      || !listingEvidenceInputSchema.safeParse({ type:doc.document_type,mimeType:doc.mime_type,byteSize:doc.byte_size }).success
      || listingEvidencePath(doc.facility_id,doc.id,doc.mime_type) !== doc.object_path) return { state:'unavailable' as const };
    const result = await db.storage.from('listing-verification').download(doc.object_path);
    if (result.error !== null || !result.data) return { state:'unavailable' as const };
    if (result.data.size !== doc.byte_size) return { state:'invalid_document' as const };
    const bytes = new Uint8Array(await result.data.arrayBuffer());
    if (!hasListingEvidenceSignature(bytes,doc.mime_type) || createHash('sha256').update(bytes).digest('hex') !== doc.sha256)
      return { state:'invalid_document' as const };
    return { state:'ready' as const,bytes,mimeType:doc.mime_type };
  } catch {
    return { state:'unavailable' as const };
  }
}

/** A platform operator must inspect the document and separately confirm authority.
 * File signatures check format only; they do not authenticate the document. */
export async function approveListingEvidence(db: SupabaseClient, value: unknown) {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) return { state:'invalid' as const };
  const input = parsed.data;
  try {
    for (const id of input.documentIds) {
      const document = await readListingEvidence(db,input.facilityId,id);
      if (document.state !== 'ready') return document;
    }
    const approval = await db.rpc('approve_listing_verification', { p_actor_id:input.actorId,p_facility_id:input.facilityId,
      p_document_ids:input.documentIds,p_expected_identity:input.expectedIdentity,p_document_verified:true,p_authority_verified:true });
    if (approval.error?.code === '42501') return { state:'forbidden' as const };
    if (approval.error !== null || approval.data !== true) return { state:'unavailable' as const };
    return { state:'approved' as const };
  } catch {
    // The operation may have committed: do not claim rejection or retry with a
    // different document until the operator reloads the current review state.
    return { state:'unavailable' as const };
  }
}
