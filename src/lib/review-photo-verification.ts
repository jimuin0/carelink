import { z } from 'zod';
import type { createServiceRoleClient } from './supabase-server';
import { readReviewPhotoLimits, REVIEW_PHOTO_BUCKET } from './review-photo-limits';

const row = z.object({ object_id: z.string().uuid(), object_path: z.string(), byte_size: z.number().int().positive(), mime_type: z.string() });
const info = z.object({ id: z.string().uuid(), bucketId: z.literal(REVIEW_PHOTO_BUCKET), name: z.string(),
  size: z.number().int().positive(), contentType: z.string() });
export type ReviewPhotoVerification = 'ready' | 'invalid' | 'unverified' | 'unavailable';
export async function verifyReviewPhotos(db: ReturnType<typeof createServiceRoleClient>, actorId: string | null,
  facilityId: string, urls: string[] | null | undefined): Promise<ReviewPhotoVerification> {
  if (!urls?.length) return 'ready';
  if (!actorId) return 'unverified';
  if (new Set(urls).size !== urls.length) return 'invalid';
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return 'unavailable';
  try {
    const limits = await readReviewPhotoLimits(db);
    if (!limits) return 'unavailable';
    const prefix = `${base}/storage/v1/object/public/${REVIEW_PHOTO_BUCKET}/`;
    for (const url of urls) {
      const path = url.slice(prefix.length);
      if (!url.startsWith(prefix) || !new RegExp(`^reviews/${facilityId}/[a-zA-Z0-9_-]+\\.(jpg|jpeg|png|webp)$`).test(path)) return 'invalid';
      const rpc = db.rpc as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
      const owned = await rpc.call(db, 'owned_review_photo_metadata', { p_actor_id: actorId, p_facility_id: facilityId, p_object_path: path });
      if (owned.error !== null) return 'unavailable';
      const parsed = z.array(row).max(1).safeParse(owned.data);
      if (!parsed.success) return 'unavailable';
      if (!parsed.data.length) return 'unverified';
      const object = parsed.data[0];
      if (object.object_path !== path || object.byte_size > limits.maxBytes || !limits.mimeTypes.includes(object.mime_type as typeof limits.mimeTypes[number])) return 'invalid';
      const actual = await db.storage.from(REVIEW_PHOTO_BUCKET).info(path);
      if (actual.error !== null) return 'unavailable';
      const verified = info.safeParse(actual.data);
      if (!verified.success) return 'unavailable';
      if (verified.data.id !== object.object_id || verified.data.name !== path || verified.data.size !== object.byte_size || verified.data.contentType !== object.mime_type) return 'unverified';
    }
    return 'ready';
  } catch { return 'unavailable'; }
}
