import type { SupabaseClient } from '@supabase/supabase-js';
import { AVATAR_BUCKET } from '@/lib/avatar-upload';

/**
 * 退会したアカウントの写真を、本人のフォルダごと消す（2026年10月23日）。
 *
 * avatars は公開バケットなので、アカウントを消しても写真のファイルは URL を知っていれば見え続けていた
 * （プロフィールの行は消えるが、Storage のファイルは連鎖では消えない）。退会の Auth 削除が確定した
 * 後に、サーバー（service role）からだけ呼ぶ。ブラウザ側の写真の処理（avatar-upload.ts）は
 * バケットの一覧を取らない（src/__tests__/avatars-no-anon-listing.test.ts）。
 * 消せたら true、一覧や削除に失敗したら false（例外は投げない＝退会自体は済んでいる）。
 */
export async function removeAllAvatars(supabase: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const bucket = supabase.storage.from(AVATAR_BUCKET);
    const { data, error } = await bucket.list(userId, { limit: 1000 });
    if (error || !Array.isArray(data)) return false;
    const paths = data.map((o) => `${userId}/${o.name}`);
    if (paths.length === 0) return true;
    const { error: removeError } = await bucket.remove(paths);
    return !removeError;
  } catch {
    return false;
  }
}
