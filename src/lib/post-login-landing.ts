import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database-overrides';
import { DEFAULT_REDIRECT, safeRedirect } from './safe-redirect';

/**
 * ログイン後の着地点の単一ソース（2026年10月23日）。
 *
 * 🔴 なぜ要るか: 戻り先（?redirect）を付けずにログインすると、店舗オーナーでも必ず
 * 来院者向けの /mypage に着地していた。ブックマークや「ログイン」ボタンから入り直した
 * オーナーには自分の管理画面へ戻る道が見えず、「店舗が消えた」と誤解される。
 *
 * 戻り先が【指定されていないときだけ】、サーバー側で facility_members の owner/admin 行を
 * 確認して /admin へ送る。来院者（行が無い・確認できない）は従来どおり /mypage。
 * 権限の判定ではない（/admin への実アクセスは middleware が改めて owner/admin を確認する）ので、
 * 確認できないときは来院者側へ倒す。
 */
export const POST_LOGIN_LANDING_PATH = '/auth/landing';
export const STORE_ADMIN_PATH = '/admin';
const STORE_ROLES = ['owner', 'admin'];

/**
 * ログイン・登録後に進む先。戻り先が指定されていればそれ（同一オリジンのパスだけ）、
 * 指定が無ければ着地点の振り分け（{@link POST_LOGIN_LANDING_PATH}）。
 */
export function loginDestination(raw: string | null | undefined, origin: string): string {
  return raw ? safeRedirect(raw, origin) : POST_LOGIN_LANDING_PATH;
}

type Client = Pick<SupabaseClient<Database>, 'from'>;
export type StoreAccess = 'store' | 'none' | 'unknown';

/** このアカウントが owner/admin として管理できる店舗を持つか。取得失敗は 'unknown'（否定と区別する）。 */
export async function readStoreAccess(client: Client, userId: string): Promise<StoreAccess> {
  try {
    const { data, error } = await client.from('facility_members').select('role')
      .eq('user_id', userId).in('role', STORE_ROLES).limit(1).maybeSingle();
    if (error) return 'unknown';
    return data ? 'store' : 'none';
  } catch {
    return 'unknown';
  }
}

/** 戻り先の指定が無いログイン後の着地点。店舗を管理できるアカウントだけ /admin。 */
export async function landingPathFor(client: Client, userId: string): Promise<string> {
  return (await readStoreAccess(client, userId)) === 'store' ? STORE_ADMIN_PATH : DEFAULT_REDIRECT;
}

/**
 * マイページ上部の「あなたの店舗」カード用。管理できる店舗（最初に所属したもの）の名前。
 * 管理できる店舗が無い・確認できないときは null（カードを出さないだけで、マイページは止めない）。
 */
export async function readManagedFacilityName(client: Client, userId: string): Promise<string | null> {
  try {
    const { data, error } = await client.from('facility_members').select('facility_profiles(name)')
      .eq('user_id', userId).in('role', STORE_ROLES)
      .order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (error || !data) return null;
    return data.facility_profiles?.name?.trim() || '店舗名未設定';
  } catch {
    return null;
  }
}
