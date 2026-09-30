import { z } from 'zod';
import type { createServiceRoleClient } from './supabase-server';
import { isSalonIntentProof, salonIntentProofHash } from './salon-submission-proof';
import { isMissingSalonPhoto, matchesSalonPhoto, salonPhotoInput, salonPhotoPath, SALON_PHOTO_BUCKET } from './salon-photo-contract';

type Database = ReturnType<typeof createServiceRoleClient>;
const rejected = z.enum(['unverified', 'expired', 'committed', 'invalid', 'conflict', 'limit']);
const row = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('prepared'), photo_id: z.uuid(), object_path: z.string() }).strict(),
  z.object({ outcome: rejected, photo_id: z.null(), object_path: z.null() }).strict(),
]);
export type SalonPhotoPreparation =
  | { state: z.infer<typeof rejected> | 'unavailable' }
  | { state: 'uploaded'; photoId: string; path: string }
  | { state: 'upload'; photoId: string; path: string; token: string };

/** Only the SDK's classified object-absence response permits signing. A
 * generic 404, missing bucket, unknown response or network error never does.
 * No raw provider error, proof or signed URL is logged or returned. */
export async function prepareSalonPhoto(db: Database, value: unknown, proof: unknown): Promise<SalonPhotoPreparation> {
  const input = salonPhotoInput.safeParse(value);
  if (!input.success) return { state: 'invalid' };
  if (!isSalonIntentProof(proof)) return { state: 'unverified' };
  const data = input.data;
  try {
    const rpc = await db.rpc('prepare_salon_photo', {
      p_intent_id: data.intentId, p_proof_hash: salonIntentProofHash(proof),
      p_selection_id: data.selectionId, p_slot: data.slot,
      p_mime_type: data.mimeType, p_byte_size: data.byteSize,
    });
    if (rpc.error !== null) return { state: 'unavailable' };
    const parsed = z.array(row).length(1).safeParse(rpc.data);
    if (!parsed.success) return { state: 'unavailable' };
    const photo = parsed.data[0];
    if (photo.outcome !== 'prepared') return { state: photo.outcome };
    const path = photo.object_path;
    if (salonPhotoPath(data.intentId, photo.photo_id, data.mimeType) !== path) return { state: 'unavailable' };
    const storage = db.storage.from(SALON_PHOTO_BUCKET);
    const info = await storage.info(path);
    if (info.error === null) {
      if (!matchesSalonPhoto(info.data, path, data)) return { state: 'conflict' };
      return { state: 'uploaded', photoId: photo.photo_id, path };
    }
    if (info.data !== null || !isMissingSalonPhoto(info.error)) return { state: 'unavailable' };
    const signed = await storage.createSignedUploadUrl(path, { upsert: false });
    if (signed.error !== null) return { state: 'unavailable' };
    const capability = z.object({ path: z.literal(path), token: z.string().min(1).max(8192) }).safeParse(signed.data);
    if (!capability.success) return { state: 'unavailable' };
    return { state: 'upload', photoId: photo.photo_id, path, token: capability.data.token };
  } catch {
    // Issuance/manifest may have succeeded. Reconcile with the same selection;
    // never delete its object or create a new selection on the caller's behalf.
    return { state: 'unavailable' };
  }
}
