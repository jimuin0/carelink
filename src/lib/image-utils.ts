/** Tiny gray SVG placeholder for remote images (avoids layout shift) */
export const SHIMMER_BLUR =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZTVlN2ViIi8+PC9zdmc+';

/**
 * Supabase Storage Image Transform
 * /storage/v1/object/public/ → /storage/v1/render/image/public/
 * 対応: width, height, quality, resize(cover|contain|fill), format(webp|jpg|png)
 */
export interface ImageTransformOptions {
  width?: number;
  height?: number;
  quality?: number;
  resize?: 'cover' | 'contain' | 'fill';
  format?: 'webp' | 'jpg' | 'png' | 'origin';
}

export function getTransformUrl(url: string | null | undefined, options: ImageTransformOptions = {}): string {
  if (!url) return '';

  // Supabase storage URL でない場合はそのまま返す
  if (!url.includes('/storage/v1/object/public/')) return url;

  const renderUrl = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
  const params = new URLSearchParams();

  if (options.width) params.set('width', String(options.width));
  if (options.height) params.set('height', String(options.height));
  if (options.quality !== undefined) params.set('quality', String(options.quality));
  if (options.resize) params.set('resize', options.resize);
  if (options.format) params.set('format', options.format);

  const qs = params.toString();
  return qs ? `${renderUrl}?${qs}` : renderUrl;
}

/** サムネイル (200×200 WebP) */
export function thumbUrl(url: string | null | undefined): string {
  return getTransformUrl(url, { width: 200, height: 200, resize: 'cover', quality: 75, format: 'webp' });
}

/** カード画像 (400×300 WebP) */
export function cardUrl(url: string | null | undefined): string {
  return getTransformUrl(url, { width: 400, height: 300, resize: 'cover', quality: 80, format: 'webp' });
}

/** ヒーロー/OG画像 (1200×630 WebP) */
export function heroUrl(url: string | null | undefined): string {
  return getTransformUrl(url, { width: 1200, height: 630, resize: 'cover', quality: 85, format: 'webp' });
}

/** アバター (80×80 WebP) */
export function avatarUrl(url: string | null | undefined): string {
  return getTransformUrl(url, { width: 80, height: 80, resize: 'cover', quality: 80, format: 'webp' });
}
