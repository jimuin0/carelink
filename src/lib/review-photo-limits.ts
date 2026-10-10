import { z } from 'zod';
import type { createServiceRoleClient } from './supabase-server';

export const REVIEW_PHOTO_BUCKET = 'review-photos';
export const REVIEW_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const REVIEW_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const reviewPhotoLimitsSchema = z.object({
  consumerVersion: z.literal(1), maxBytes: z.number().int().positive().max(REVIEW_PHOTO_MAX_BYTES),
  mimeTypes: z.array(z.enum(REVIEW_PHOTO_MIME_TYPES)).min(1).max(3),
}).strict();
export type ReviewPhotoLimits = z.infer<typeof reviewPhotoLimitsSchema>;
const bucketSchema = z.object({ id: z.literal(REVIEW_PHOTO_BUCKET), public: z.literal(true),
  file_size_limit: z.number().int().positive().nullable(), allowed_mime_types: z.array(z.string()).nullable() });

/** Actual bucket metadata is required. Preserve stricter limits and private
 * visibility; a public review image consumer cannot silently use a private URL.
 * Provider-wide capacity still requires the separate deployment preflight. */
export async function readReviewPhotoLimits(db: ReturnType<typeof createServiceRoleClient>): Promise<ReviewPhotoLimits | null> {
  try {
    const response = await db.storage.getBucket(REVIEW_PHOTO_BUCKET);
    if (response.error !== null) return null;
    const result = bucketSchema.safeParse(response.data);
    if (!result.success) return null;
    const mimes = result.data.allowed_mime_types;
    const mimeTypes = mimes === null ? [...REVIEW_PHOTO_MIME_TYPES] : REVIEW_PHOTO_MIME_TYPES.filter(m => mimes.includes(m));
    if (!mimeTypes.length) return null;
    return { consumerVersion: 1, maxBytes: Math.min(REVIEW_PHOTO_MAX_BYTES, result.data.file_size_limit ?? REVIEW_PHOTO_MAX_BYTES), mimeTypes };
  } catch { return null; }
}
