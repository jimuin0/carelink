import { z } from 'zod';

export const SALON_PHOTO_BUCKET = 'carelink-uploads';
const mime = z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' } as const;

export const salonPhotoInput = z.object({
  intentId: z.uuid(), selectionId: z.uuid(),
  slot: z.number().int().min(0).max(6), mimeType: mime,
  byteSize: z.number().int().min(1).max(10 * 1024 * 1024),
}).strict();
export type SalonPhotoInput = z.infer<typeof salonPhotoInput>;

const identity = z.object({ intentId: z.uuid(), photoId: z.uuid(), mimeType: mime });
/** A provider result cannot choose another application's object path. */
export function salonPhotoPath(intentId: string, photoId: string, mimeType: unknown): string | null {
  const parsed = identity.safeParse({ intentId, photoId, mimeType });
  if (!parsed.success) return null;
  const value = parsed.data;
  return `salon-intents/${value.intentId.toLowerCase()}/${value.photoId.toLowerCase()}.${extensions[value.mimeType]}`;
}

const storageInfo = z.object({
  bucketId: z.literal(SALON_PHOTO_BUCKET), name: z.string(),
  size: z.number().int().positive(), contentType: mime,
});
/** Metadata confirms only scope/declared type/size, not image authenticity. */
export function matchesSalonPhoto(info: unknown, path: string, input: Pick<SalonPhotoInput, 'byteSize' | 'mimeType'>): boolean {
  const parsed = storageInfo.safeParse(info);
  return parsed.success && parsed.data.name === path
    && parsed.data.size === input.byteSize && parsed.data.contentType === input.mimeType;
}
