import { z } from 'zod';
import type { SalonFormValues } from './validations';
import { FACILITY_INPUT_LIMITS as limits } from './facility-input-limits';
import { DESIRED_START_DATES } from './constants';

export const SALON_DRAFT_MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const SALON_DRAFT_MAX_BYTES = Math.ceil(7 * SALON_DRAFT_MAX_PHOTO_BYTES / 3) * 4 + 65536;
export const SALON_DRAFT_BACKUP_ERROR = '下書きファイルを保存または読み込めませんでした。入力と写真は変更されていません。';

// A local input backup is deliberately not a valid submission/receipt. Keep
// incomplete strings verbatim; final submission still uses salonFullSchema.
const text = (max: number) => z.string().max(max).optional();
const number = z.union([z.number().int().min(0).max(9999), z.nan()])
  .transform(value => Number.isNaN(value) ? null : value).nullable().optional();
const valuesSchema = z.object({
  facility_name: text(limits.name), business_type: text(50), representative_name: text(100),
  contact_name: text(100), email: text(254), phone: text(30).nullable(), contact_phone: text(30).nullable(),
  website: text(limits.website), postal_code: text(8), address: text(limits.address),
  prefecture: text(10).nullable(), city: text(limits.city).nullable(), building_name: text(limits.building),
  nearest_station: text(limits.nearestStation), business_hours: text(200), regular_holiday: text(limits.regularHoliday),
  seat_count: number, staff_count: number, has_parking: z.boolean().optional(),
  features: z.array(z.string().max(50)).max(20).optional(), pr_text: text(1000),
  desired_start_date: z.enum(DESIRED_START_DATES).or(z.literal('')).optional(),
}).strict();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const metadataSchema = z.object({
  name: z.string().min(1).max(255).regex(/^[^\u0000-\u001f\u007f/\\]+$/),
  type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  size: z.number().int().min(1).max(SALON_DRAFT_MAX_PHOTO_BYTES),
  lastModified: z.number().int().min(0).max(8640000000000000),
}).strict();
const photoSchema = metadataSchema.extend({
  base64: z.string().min(1).max(Math.ceil(SALON_DRAFT_MAX_PHOTO_BYTES / 3) * 4),
  sha256: sha256Schema,
}).strict();
const payloadSchema = z.object({ values: valuesSchema, photos: z.array(photoSchema.nullable()).length(7) }).strict();
const envelopeSchema = z.object({ format: z.literal('carelink-local-draft'), version: z.literal(1),
  payload: payloadSchema, sha256: sha256Schema }).strict();

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
const payloadBytes = (payload: unknown) => new TextEncoder().encode(JSON.stringify(payload));
function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}
function decode(photo: z.infer<typeof photoSchema>): Uint8Array {
  if (photo.base64.length !== Math.ceil(photo.size / 3) * 4) throw new Error();
  const binary = atob(photo.base64);
  if (binary.length !== photo.size || btoa(binary) !== photo.base64) throw new Error();
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

/** Manual download only: original bytes/slot order, no compression, network,
 * persistence, capability, consent, or lifetime attached to this input file. */
export async function exportSalonDraftBackup(values: unknown, photos: readonly (File | null)[]): Promise<Blob> {
  try {
    const parsedValues = valuesSchema.parse(values);
    if (photos.length > 7) throw new Error();
    const saved = [];
    for (let slot = 0; slot < 7; slot++) {
      const file = photos[slot];
      if (file === undefined || file === null) { saved.push(null); continue; }
      if (!(file instanceof File)) throw new Error();
      const metadata = metadataSchema.parse({ name: file.name, type: file.type, size: file.size, lastModified: file.lastModified });
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length !== metadata.size) throw new Error();
      saved.push({ ...metadata, base64: encode(bytes), sha256: await digest(bytes) });
    }
    const payload = { values: parsedValues, photos: saved };
    const blob = new Blob([JSON.stringify({ format: 'carelink-local-draft', version: 1,
      payload, sha256: await digest(payloadBytes(payload)) })], { type: 'application/json' });
    return blob;
  } catch {
    throw new Error(SALON_DRAFT_BACKUP_ERROR);
  }
}

/** Validate everything before returning any input or files. A checksum detects
 * corruption, not authorship: this file can never prove an accepted receipt. */
export async function importSalonDraftBackup(file: Blob): Promise<{
  values: Partial<SalonFormValues>; photos: (File | null)[];
}> {
  try {
    if (!(file instanceof Blob) || file.size === 0 || file.size > SALON_DRAFT_MAX_BYTES) throw new Error();
    const raw: unknown = JSON.parse(await file.text());
    const parsed = envelopeSchema.parse(raw);
    // Check the raw payload too: parsing must not normalize tampered metadata
    // or turn an unknown transport/auth field into an ignored extra key.
    const originalPayload = (raw as { payload: unknown }).payload;
    if (await digest(payloadBytes(originalPayload)) !== parsed.sha256) throw new Error();
    const photos: (File | null)[] = [];
    for (const photo of parsed.payload.photos) {
      if (photo === null) { photos.push(null); continue; }
      const bytes = decode(photo);
      if (await digest(bytes) !== photo.sha256) throw new Error();
      photos.push(new File([Uint8Array.from(bytes).buffer], photo.name, { type: photo.type, lastModified: photo.lastModified }));
    }
    return { values: parsed.payload.values, photos };
  } catch {
    throw new Error(SALON_DRAFT_BACKUP_ERROR);
  }
}
