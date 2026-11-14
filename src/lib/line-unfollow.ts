import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * LINE のフォロー解除（ブロック）を記録した宛先かを返す（点検 B3-12・2026年11月13日）。
 *
 * 以前は unfollow で line_user_links の行そのものを削除していたため、本人確認済みの連携
 * （proof_version / verified_at）まで消え、再フォローしても連携し直すまで通知が届かなかった。
 * 現在は行を残して `unfollowed_at` を記録し（再フォローで NULL に戻す）、送信側がこの関数か
 * 同じ条件（unfollowed_at IS NULL）で宛先から外す。
 *
 * DB を読めないときは例外にする（呼び出し側の再送・失敗扱いに委ねる。黙って送らない／送るのどちらにも倒さない）。
 */
export async function isLineRecipientUnfollowed(client: SupabaseClient, lineUserId: string): Promise<boolean> {
  const { data, error } = await client.from('line_user_links')
    .select('id').eq('line_user_id', lineUserId).not('unfollowed_at', 'is', null).limit(1);
  if (error) throw new Error('LINE follow state unavailable');
  return (data ?? []).length > 0;
}

/** line_user_links の行が「今フォロー中」か（unfollowed_at が無い）。 */
export function isFollowingLink(link: { unfollowed_at?: string | null } | null | undefined): boolean {
  return !link?.unfollowed_at;
}
