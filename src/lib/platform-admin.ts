import { createServerSupabaseAuthClient } from './supabase-server-auth';

/**
 * プラットフォーム全体管理者判定の単一ソース（監査A6b）。
 *
 * 背景: admin/backup は profiles.is_platform_admin(DBカラム)方式、admin/features系のみ
 * SUPER_ADMIN_USER_IDS(環境変数)方式という二重化があった。環境変数方式は再デプロイなしに
 * 変更できず複数人の管理もしづらいため、DBカラム方式に一本化する。
 * 未認証・profile不在・is_platform_admin!=trueは全てnullを返す（フェイルセーフ）。
 */
export async function requirePlatformAdmin() {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .single();
  if (!profile?.is_platform_admin) return null;
  return user;
}
