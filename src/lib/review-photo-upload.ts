import { compressImage } from './image-compress';
import { REVIEW_PHOTO_BUCKET, type ReviewPhotoLimits } from './review-photo-limits';
import type { createBrowserSupabaseClient } from './supabase-browser';

type Upload = { path: string; file: File; url?: string; attempted: boolean };
export type ReviewPhotoUploads = Map<File, Upload>;
function acceptable(file: Blob, limits: ReviewPhotoLimits): boolean {
  return file.size > 0 && file.size <= limits.maxBytes && limits.mimeTypes.includes(file.type as ReviewPhotoLimits['mimeTypes'][number]);
}
async function bytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('REVIEW_PHOTO_READ_FAILED')); reader.readAsArrayBuffer(blob);
  });
}
async function sameBytes(a: Blob, b: Blob): Promise<boolean> {
  if (a.size !== b.size || a.type !== b.type) return false;
  const [left, right] = await Promise.all([bytes(a), bytes(b)]);
  const x = new Uint8Array(left), y = new Uint8Array(right);
  return x.every((v, i) => v === y[i]);
}

/** Keep original Files and reuse opaque paths on upload-only retries. Never
 * delete an uploaded object because the subsequent review reply was lost. */
export async function uploadReviewPhotos(db: ReturnType<typeof createBrowserSupabaseClient>, facilityId: string,
  originals: File[], limits: ReviewPhotoLimits, uploads: ReviewPhotoUploads): Promise<string[]> {
  const storage = db.storage.from(REVIEW_PHOTO_BUCKET);
  const urls: string[] = [];
  for (const original of originals) {
    let upload = uploads.get(original);
    if (!upload) {
      const compressed = await compressImage(original);
      const file = acceptable(compressed, limits) ? compressed : acceptable(original, limits) ? original : null;
      if (!file) throw new Error('写真を保存上限・対応形式に収められません。元写真を保持しています。写真の選択を確認してください。');
      const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
      const ext = extensions[file.type]!;
      upload = { file, path: `reviews/${facilityId}/${crypto.randomUUID()}.${ext}`, attempted: false };
      uploads.set(original, upload);
    }
    if (!acceptable(upload.file, limits)) throw new Error('写真の保存上限が変更されました。入力と元写真を保持して、写真の選択を確認してください。');
    if (!upload.url && upload.attempted) {
      // An upload may have committed before its reply disappeared. Only exact
      // content readback at our fixed path may recover it; 409 is not success.
      const previous = await storage.download(upload.path);
      if (previous.error === null && previous.data && await sameBytes(previous.data, upload.file)) {
        upload.url = storage.getPublicUrl(upload.path).data.publicUrl;
      }
    }
    if (!upload.url) {
      upload.attempted = true;
      const result = await storage.upload(upload.path, upload.file, { upsert: false, contentType: upload.file.type });
      if (result.error !== null || !result.data || result.data.path !== upload.path) {
        throw new Error('写真の保存を確認できませんでした。本文は送信していません。入力と元写真を保持して、時間をおいて再確認してください。');
      }
      upload.url = storage.getPublicUrl(upload.path).data.publicUrl;
    }
    urls.push(upload.url);
  }
  return urls;
}
