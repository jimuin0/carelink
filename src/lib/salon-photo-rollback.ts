import { supabase } from '@/lib/supabase';

/**
 * 【2026年7月8日 恒久根治】施設オーナー自己登録(register/page.tsx)で、写真アップロード成功後に
 * /api/salons が失敗（バリデーション/レート制限/ネットワーク断等）すると、アップロード済み
 * ファイルがストレージに孤児として残り続けていた。再送信時は毎回新しい crypto.randomUUID() で
 * 再アップロードするため、失敗を繰り返すほど孤児が積み上がる。
 * page.tsx は Next.js の制約で default export 以外の任意 export ができないため、テスト容易化の
 * ためロールバック処理をこの独立モジュールに分離する（失敗しても再スロー・呼び出し元のトースト
 * 表示を妨げないよう内部で握る）。
 */
export async function rollbackUploadedSalonPhotos(uploadedPaths: string[]): Promise<void> {
  if (uploadedPaths.length === 0) return;
  await supabase.storage.from('carelink-uploads').remove(uploadedPaths).catch(() => {});
}
