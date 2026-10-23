/**
 * 管理画面「写真」で複数枚を選んだときの振り分け。
 *
 * 以前は 1 枚でも 5MB を超える（または形式が違う）写真があると、選んだ全部を断り、
 * どの写真が原因かも言わなかった（スマホの写真は 5MB を超えやすく、10 枚選んで 1 枚も上がらない）。
 * 1 枚ずつ判定し、大きすぎる写真は縮小を試してから判定する。上げられない写真はファイル名と理由を返す。
 */
export const ADMIN_PHOTO_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];
export const ADMIN_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export type PhotoRejectReason = 'type' | 'size';

export interface PhotoRejection {
  name: string;
  reason: PhotoRejectReason;
}

export interface PhotoBatch {
  accepted: File[];
  rejected: PhotoRejection[];
}

const acceptable = (file: File) => ADMIN_PHOTO_TYPES.includes(file.type) && file.size <= ADMIN_PHOTO_MAX_BYTES;

/**
 * 選んだ写真を、上げる写真と上げない写真に分ける。並びは選んだ順のまま。
 * shrink は大きすぎる写真の縮小（ブラウザでは image-compress の compressImage）。失敗しても例外にせず、
 * 縮小できなかった写真として断る。
 */
export async function preparePhotoBatch(files: readonly File[], shrink: (file: File) => Promise<File>): Promise<PhotoBatch> {
  const accepted: File[] = [];
  const rejected: PhotoRejection[] = [];
  for (const file of files) {
    if (!ADMIN_PHOTO_TYPES.includes(file.type)) {
      rejected.push({ name: file.name, reason: 'type' });
      continue;
    }
    if (file.size <= ADMIN_PHOTO_MAX_BYTES) {
      accepted.push(file);
      continue;
    }
    const smaller = await shrink(file).catch(() => null);
    if (smaller && acceptable(smaller)) accepted.push(smaller);
    else rejected.push({ name: file.name, reason: 'size' });
  }
  return { accepted, rejected };
}

const REASON_TEXT: Record<PhotoRejectReason, string> = {
  type: 'JPG・PNG・WebP以外の形式',
  size: '5MBを超え、縮小しても収まりませんでした',
};

/** 上げなかった写真の一覧（画面に残す文言）。1 行 1 枚。 */
export function describePhotoRejections(rejected: readonly PhotoRejection[]): string[] {
  return rejected.map(({ name, reason }) => `${name}（${REASON_TEXT[reason]}）`);
}
