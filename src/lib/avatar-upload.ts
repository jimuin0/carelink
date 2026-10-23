import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * マイページのプロフィール写真の保存（2026年10月23日）。
 *
 * 以前は `avatars/<アカウントID>/avatar.<拡張子>` に上書き保存していた。avatars は公開バケットなので、
 * アカウント ID を知っていれば拡張子を 3 通り試すだけで本人の顔写真を取得できた（アカウント ID は
 * 店舗側の画面などで見える場面がある）。さらに匿名の SELECT ポリシー「Public read avatars」が
 * 残っていたため、Storage API の一覧でアカウント ID そのものを列挙できた（一覧は migration
 * 20261023190100 で塞いだ）。
 *
 * 新しく保存する写真は、推測できない名前（乱数）にする。フォルダはアカウント ID のまま
 * （書き込みポリシー avatars_insert_own がフォルダ＝本人で判定するため）。表示は公開 URL のままで、
 * 既に保存済みの写真（avatar.<拡張子>）も今まで通り表示される。次に写真を変えたとき、前の写真
 * （本人のフォルダの中のものだけ）を消す。
 */
export const AVATAR_BUCKET = 'avatars';

/** 受け付ける画像と保存する拡張子（入力欄の accept と同じ 3 種類）。ファイル名の拡張子は信用しない。 */
const AVATAR_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** 本人のフォルダの中の、推測できない名前。受け付けない形式なら null。 */
export function avatarObjectPath(userId: string, mimeType: string, random: string): string | null {
  const ext = Object.prototype.hasOwnProperty.call(AVATAR_EXTENSIONS, mimeType) ? AVATAR_EXTENSIONS[mimeType] : null;
  return ext ? `${userId}/${random}.${ext}` : null;
}

/**
 * 保存済みの写真の URL から、本人のフォルダの中のオブジェクトのパスを取り出す。
 * 本人のフォルダの外（LINE のプロフィール画像・他人のフォルダ・別のバケット）なら null（消さない）。
 */
export function ownAvatarPathFromUrl(url: string | null | undefined, userId: string): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
  const at = url.indexOf(marker);
  if (at === -1) return null;
  let path: string;
  try {
    path = decodeURIComponent(url.slice(at + marker.length).split(/[?#]/)[0]);
  } catch {
    return null;
  }
  const [folder, name, ...rest] = path.split('/');
  return folder === userId && name && rest.length === 0 ? path : null;
}

export class AvatarUploadError extends Error {}

/**
 * 写真を保存し、プロフィールの avatar_url を新しい公開 URL にする。前の写真は保存が済んでから消す
 * （消せなくても失敗にしない＝写真の変更は済んでいる）。新しい公開 URL を返す。
 */
export async function uploadAvatar(
  supabase: SupabaseClient, userId: string, file: File, previousUrl: string | null,
  random: string = crypto.randomUUID(),
): Promise<string> {
  const path = avatarObjectPath(userId, file.type, random);
  if (!path) throw new AvatarUploadError('unsupported image type');
  const { error: uploadError } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, { upsert: false, contentType: file.type });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  const { error: updateError } = await supabase.from('profiles').update({ avatar_url: data.publicUrl }).eq('id', userId);
  if (updateError) {
    // プロフィールが前の写真のままなので、今回の写真は使われない。残さない（失敗しても続ける）。
    await supabase.storage.from(AVATAR_BUCKET).remove([path]).catch(() => undefined);
    throw updateError;
  }
  const previous = ownAvatarPathFromUrl(previousUrl, userId);
  if (previous && previous !== path) {
    await supabase.storage.from(AVATAR_BUCKET).remove([previous]).catch(() => undefined);
  }
  return data.publicUrl;
}

/**
 * 退会したアカウントの写真を、本人のフォルダごと消す（2026年10月23日）。
 *
 * avatars は公開バケットなので、アカウントを消しても写真のファイルは URL を知っていれば見え続けていた
 * （プロフィールの行は消えるが、Storage のファイルは連鎖では消えない）。退会の Auth 削除が確定した
 * 後に呼ぶ。消せたら true、一覧や削除に失敗したら false（例外は投げない＝退会自体は済んでいる）。
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
