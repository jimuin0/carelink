import { z } from 'zod';
import type { createServiceRoleClient } from './supabase-server';
import { salonInsertSchema } from './validations';
import { registrationConsentSchema, REGISTRATION_TERMS_SHA256 } from './registration-consent';
import { canonicalSalonSubmission, SALON_CANONICAL_VERSION } from './salon-submission-contract';
import { isSalonIntentProof, salonIntentProofHash, salonPayloadHmac, SALON_HMAC_SCHEME } from './salon-submission-proof';
import { readSalonIntentStatus } from './salon-submission-intent';
import { isMissingSalonPhoto, matchesSalonPhoto, salonPhotoInput, salonPhotoPath, SALON_PHOTO_BUCKET } from './salon-photo-contract';
import { validateFacilityPrText } from './medical-ad-guard';
import { SALON_PR_TEXT_PROHIBITED_MESSAGE } from './salon-field-errors';
import { medicalBusinessTypes } from './medical-business-types';
import type { SupabaseClient } from '@supabase/supabase-js';

export const salonCommitInput = z.object({
  intentId: z.uuid(),
  registration: salonInsertSchema.omit({ photo_url: true, photo_urls: true, recaptcha_token: true }).strict(),
  photoIds: z.array(z.uuid()).max(7).refine(ids => new Set(ids.map(id => id.toLowerCase())).size === ids.length),
  consent: registrationConsentSchema.optional(),
}).strict();
const manifest = z.object({
  id: z.uuid(), intent_id: z.uuid(), slot: salonPhotoInput.shape.slot,
  mime_type: salonPhotoInput.shape.mimeType, byte_size: salonPhotoInput.shape.byteSize,
  object_path: z.string(),
}).strict();
const rejection = z.enum(['unverified', 'expired', 'conflict']);
const receipt = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.enum(['committed', 'replay']), receipt_id: z.uuid() }).strict(),
  z.object({ outcome: rejection, receipt_id: z.null() }).strict(),
]);
export type SalonCommitResult =
  | { state: 'invalid'; fieldErrors?: { pr_text: string } }
  | { state: 'unverified' | 'expired' | 'conflict' | 'unavailable' | 'photo_unverified' | 'unknown' | 'consent_required' }
  | { state: 'committed' | 'replay'; receiptId: string };
type Database = ReturnType<typeof createServiceRoleClient>;

/** No write/notification happens outside the atomic RPC. A lost RPC result is
 * unknown, never a confirmed rejection. Uploaded objects are never deleted.
 * Photo rows are immutable, and ordinary Storage update/delete is forbidden.
 * Any future cleanup must take the same intent lock and recheck references. */
export async function commitSalonSubmission(db: Database, value: unknown, proof: unknown): Promise<SalonCommitResult> {
  const parsed = salonCommitInput.safeParse(value);
  if (!parsed.success) return { state: 'invalid' };
  if (!isSalonIntentProof(proof)) return { state: 'unverified' };
  const input = parsed.data;
  if (input.registration.medical_specialties?.length && !medicalBusinessTypes.includes(input.registration.business_type)) return { state:'invalid' };
  let attemptedCommit = false;
  try {
    // Verify capability before reading any selected manifest, including an
    // empty photo selection. The RPC independently rechecks it under lock.
    const status = await readSalonIntentStatus(db, input.intentId, proof);
    if (status.state !== 'uncommitted' && status.state !== 'committed') return { state: status.state };
    // A historical committed receipt can still be replayed exactly. New
    // registrations always require the current explicit declaration.
    if (status.state === 'uncommitted' && input.consent === undefined) return { state: 'consent_required' };
    // /admin/settings と同じ医療広告ガイドライン・あはき法の検査。PR文は取り込み後に施設紹介として公開候補になる。
    // 新しい申込にだけ適用する：この規則（や禁止語の一覧）より前に受け付けた申込の応答が失われた場合も、
    // 同じ内容の再送は従来どおり受付済みとして照合できなければならない（照合と HMAC は変えない）。
    // 書き込みより前に、送信内容だけで決まる拒否なので、同じ申込を直して送り直してよい。
    if (status.state === 'uncommitted' && !validateFacilityPrText(input.registration.pr_text).ok) {
      return { state: 'invalid', fieldErrors: { pr_text: SALON_PR_TEXT_PROHIBITED_MESSAGE } };
    }
    const urls: string[] = [];
    if (input.photoIds.length > 0) {
      const ids = input.photoIds.map(id => id.toLowerCase());
      const result = await db.from('salon_submission_photos')
        .select('id,intent_id,slot,mime_type,byte_size,object_path')
        .eq('intent_id', input.intentId).in('id', ids);
      if (result.error !== null) return { state: 'unavailable' };
      const photos = z.array(manifest).safeParse(result.data);
      if (!photos.success) return { state: 'unavailable' };
      if (photos.data.length !== ids.length
        || new Set(photos.data.map(photo => photo.id)).size !== ids.length
        || new Set(photos.data.map(photo => photo.slot)).size !== ids.length) return { state: 'photo_unverified' };
      const storage = db.storage.from(SALON_PHOTO_BUCKET);
      for (const photo of photos.data.sort((a, b) => a.slot - b.slot)) {
        if (!ids.includes(photo.id) || photo.intent_id !== input.intentId.toLowerCase()
          || photo.object_path !== salonPhotoPath(input.intentId, photo.id, photo.mime_type)) return { state: 'photo_unverified' };
        // Receipt replay must not depend on a currently healthy Storage API.
        // The HMAC still has to match the immutable original business payload.
        if (status.state === 'uncommitted') {
          const info = await storage.info(photo.object_path);
          if (info.error !== null) return { state: info.data === null && isMissingSalonPhoto(info.error) ? 'photo_unverified' : 'unavailable' };
          if (!matchesSalonPhoto(info.data, photo.object_path,
            { byteSize: photo.byte_size, mimeType: photo.mime_type })) return { state: 'photo_unverified' };
        }
        const publicUrl = storage.getPublicUrl(photo.object_path).data.publicUrl;
        const url = new URL(publicUrl);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
          || url.pathname !== `/storage/v1/object/public/${SALON_PHOTO_BUCKET}/${photo.object_path}`) return { state: 'unavailable' };
        urls.push(publicUrl);
      }
    }
    const canonical = canonicalSalonSubmission({ ...input.registration, photo_urls: urls });
    if (!canonical) return { state: 'invalid' };
    attemptedCommit = true;
    const args = {
      p_intent_id: input.intentId, p_proof_hash: salonIntentProofHash(proof),
      p_canonical_version: SALON_CANONICAL_VERSION, p_hmac_scheme: SALON_HMAC_SCHEME,
      p_payload_hmac: salonPayloadHmac(proof, canonical.serialized), p_registration: canonical.row,
    };
    // Missing declarations are allowed only for exact historical receipt replay.
    // A fresh transaction always calls the declaration-recording wrapper.
    const result = input.consent === undefined
      ? await db.rpc('commit_salon_submission', args)
      : input.registration.medical_specialties?.length
        // The generated database types are refreshed from an isolated DB before merge.
        ? await (db as SupabaseClient).rpc('commit_salon_submission_with_specialties', { ...args, p_terms_sha256: REGISTRATION_TERMS_SHA256 })
        : await db.rpc('commit_salon_submission_with_consent', { ...args, p_terms_sha256: REGISTRATION_TERMS_SHA256 });
    if (result.error !== null) return { state: 'unknown' };
    const response = z.array(receipt).length(1).safeParse(result.data);
    if (!response.success) return { state: 'unknown' };
    const committed = response.data[0];
    if (committed.outcome === 'committed' || committed.outcome === 'replay') {
      if (status.state === 'committed' && status.receiptId !== committed.receipt_id) return { state: 'unknown' };
      return { state: committed.outcome, receiptId: committed.receipt_id };
    }
    return { state: committed.outcome };
  } catch {
    // Do not leak applicant fields, capability, HMAC or provider errors.
    return { state: attemptedCommit ? 'unknown' : 'unavailable' };
  }
}
