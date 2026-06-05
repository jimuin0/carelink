// 画像レコード削除時に Storage 実体も削除して孤児化を防ぐためのヘルパー（round3 監査 #06）。
// Supabase Storage の公開URL（.../storage/v1/object/public/<bucket>/<path>）から <path> を抽出する。
// data URI / 外部URL / 当該バケット以外は null（削除対象外）を返す。

export const UPLOAD_BUCKET = 'carelink-uploads';

/** 公開URLから当該バケットのオブジェクトパスを抽出（対象外は null） */
export function storagePathFromPublicUrl(url: string | null | undefined, bucket: string = UPLOAD_BUCKET): string | null {
  if (!url || url.startsWith('data:')) return null;
  const marker = `/${bucket}/`;
  const i = url.indexOf(marker);
  if (i < 0) return null;
  const rest = url.slice(i + marker.length).split('?')[0];
  if (!rest) return null;
  try { return decodeURIComponent(rest); } catch { return rest; }
}

/** 複数URLからパス配列を抽出（重複・null除去）。Storage remove に渡す用 */
export function storagePathsFromUrls(urls: (string | null | undefined)[], bucket: string = UPLOAD_BUCKET): string[] {
  const out: string[] = [];
  for (const u of urls) {
    const p = storagePathFromPublicUrl(u, bucket);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}
