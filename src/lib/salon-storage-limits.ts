import { z } from 'zod';
import type { createServiceRoleClient } from './supabase-server';
import { SALON_PHOTO_BUCKET, SALON_PHOTO_MAX_BYTES, SALON_PHOTO_MIME_TYPES } from './salon-photo-contract';

const bucket = z.object({ id: z.literal(SALON_PHOTO_BUCKET),
  file_size_limit: z.number().int().positive().nullable(), allowed_mime_types: z.array(z.string()).nullable() });
export const salonStorageLimitsSchema = z.object({ maxBytes: z.number().int().positive().max(SALON_PHOTO_MAX_BYTES),
  mimeTypes: z.array(z.enum(SALON_PHOTO_MIME_TYPES)).min(1).max(4) }).strict();
export type SalonStorageLimits = z.infer<typeof salonStorageLimitsSchema>;

/** Read actual bucket limits without relaxing them. The provider's global
 * limit is a separate deployment preflight; bucket data cannot prove it. */
export async function readSalonStorageLimits(db: ReturnType<typeof createServiceRoleClient>): Promise<
  { state: 'ready'; limits: SalonStorageLimits } | { state: 'unavailable' }
> {
  try {
    const result = await db.storage.getBucket(SALON_PHOTO_BUCKET);
    if (result.error !== null) return { state: 'unavailable' };
    const parsed = bucket.safeParse(result.data);
    if (!parsed.success) return { state: 'unavailable' };
    const configured = parsed.data;
    const mimeTypes = configured.allowed_mime_types == null ? [...SALON_PHOTO_MIME_TYPES]
      : SALON_PHOTO_MIME_TYPES.filter(type => configured.allowed_mime_types!.includes(type));
    if (mimeTypes.length === 0) return { state: 'unavailable' };
    return { state: 'ready', limits: { maxBytes: Math.min(SALON_PHOTO_MAX_BYTES, configured.file_size_limit ?? SALON_PHOTO_MAX_BYTES), mimeTypes } };
  } catch { return { state: 'unavailable' }; }
}
