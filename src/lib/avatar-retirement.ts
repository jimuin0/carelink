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
    // Storage の一覧は一度に最大 1000 件。先に全ページを読み、削除による
    // offset のずれで後続ページを飛ばさないようにする。
    const paths: string[] = [];
    for (let page = 0; page < 100; page++) {
      const { data, error } = await bucket.list(userId, { limit: 1000, offset: page * 1000 });
      if (error || !Array.isArray(data)) return false;
      paths.push(...data.map((o) => `${userId}/${o.name}`));
      if (data.length < 1000) {
        for (let start = 0; start < paths.length; start += 1000) {
          const { error: removeError } = await bucket.remove(paths.slice(start, start + 1000));
          if (removeError) return false;
        }
        return true;
      }
    }
    // 想定を超える件数は「全件削除済み」と誤報しない。
    return false;
  } catch {
    return false;
  }
}
