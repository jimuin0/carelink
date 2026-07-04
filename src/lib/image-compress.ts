/**
 * 画像のクライアント側リサイズ・圧縮ユーティリティ（監査P6）。
 *
 * ReviewForm では実装済みだったが register（施設登録）では生ファイルを無圧縮・直列で
 * アップロードしており、最大7枚×10MBの離脱要因になっていた。共通化して両方で使う。
 * ブラウザ専用（Image / canvas 依存）。
 */
export const MAX_OUTPUT_SIZE = 2 * 1024 * 1024; // 圧縮後 2MB 目標
export const MAX_DIMENSION = 1920; // px（長辺）

/** 画像をリサイズ・圧縮して File として返す。失敗時は元 File をそのまま返す（フォールバック）。 */
export async function compressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round((height * MAX_DIMENSION) / width);
          width = MAX_DIMENSION;
        } else {
          width = Math.round((width * MAX_DIMENSION) / height);
          height = MAX_DIMENSION;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, width, height);
      const tryCompress = (quality: number) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) { resolve(file); return; }
            if (blob.size <= MAX_OUTPUT_SIZE || quality <= 0.4) {
              resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
            } else {
              tryCompress(quality - 0.1);
            }
          },
          'image/jpeg',
          quality
        );
      };
      tryCompress(0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像読み込みエラー')); };
    img.src = url;
  });
}
