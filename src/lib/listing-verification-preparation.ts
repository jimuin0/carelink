import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { isMissingSalonPhoto } from './salon-photo-contract';
import { listingEvidenceInputSchema, listingEvidencePath } from './listing-verification-evidence';

const inputSchema = listingEvidenceInputSchema.extend({ actorId: z.uuid(), facilityId: z.uuid(), documentId: z.uuid(), sha256:z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const resultSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('prepared'), object_path: z.string() }).strict(),
  z.object({ outcome: z.enum(['invalid', 'unverified', 'conflict', 'limit']), object_path: z.null() }).strict(),
]);

/** Issue an upload capability only for an immutable, transaction-authorized manifest. */
export async function prepareListingEvidence(db: SupabaseClient, value: unknown) {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) return { state: 'invalid' as const };
  const input = parsed.data;
  try {
    const result = await db.rpc('prepare_listing_verification_document', {
      p_actor_id: input.actorId, p_facility_id: input.facilityId, p_document_id: input.documentId,
      p_document_type: input.type, p_mime_type: input.mimeType, p_byte_size: input.byteSize,
      p_sha256:input.sha256,
    });
    if (result.error !== null) return { state: 'unavailable' as const };
    const rows = z.array(resultSchema).length(1).safeParse(result.data);
    if (!rows.success) return { state: 'unavailable' as const };
    const manifest = rows.data[0];
    if (manifest.outcome !== 'prepared') return { state: manifest.outcome };
    const path = listingEvidencePath(input.facilityId, input.documentId, input.mimeType);
    if (!path || path !== manifest.object_path) return { state: 'unavailable' as const };
    const storage = db.storage.from('listing-verification');
    const info = await storage.info(path);
    if (info.error === null) {
      const object = z.object({ bucketId: z.literal('listing-verification'), name: z.literal(path),
        size: z.literal(input.byteSize), contentType: z.literal(input.mimeType) }).safeParse(info.data);
      return object.success ? { state: 'uploaded' as const } : { state: 'conflict' as const };
    }
    if (info.data !== null || !isMissingSalonPhoto(info.error)) return { state: 'unavailable' as const };
    const signed = await storage.createSignedUploadUrl(path, { upsert: false });
    if (signed.error !== null) return { state: 'unavailable' as const };
    const token = z.object({ path: z.literal(path), token: z.string().min(1).max(8192) }).safeParse(signed.data);
    if (!token.success) return { state: 'unavailable' as const };
    return { state: 'upload' as const, path, token: token.data.token };
  } catch {
    // A provider failure may happen after the manifest or upload was created.
    // Retry only with the same document ID; never delete uploaded material.
    return { state: 'unavailable' as const };
  }
}
