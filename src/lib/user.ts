import { createServiceRoleClient } from '@/lib/supabase-server';
import { verifyAuthUser } from '@/lib/auth-verification';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import type { Profile, Favorite, FacilityCardData } from '@/types';
import type { Database } from '@/types/database.types';

// profiles テーブルの実スキーマ（supabase/migrations/20260323000001_phase2_users_search.sql）
// を確認すると、created_at/updated_at は `DEFAULT now()` のみで NOT NULL 制約が無く、
// gender は `CHECK (gender IN ('male','female','other','unspecified'))` で値を絞っているが
// CHECK 制約は PostgREST の型イントロスペクションには反映されないため列自体の型は
// 素の string のままである。つまり <Database> 型配線後にコンパイラが検出した通り、
// select('*') が実際に返す DB 行の型は、src/types/index.ts の Profile 型
// （created_at/updated_at を必須・gender をリテラル型に限定）より緩い。
// Profile 型はこのファイルの担当範囲外（他ファイル・他タスクの担当）のため書き換えず、
// また存在しないデータを捏造して created_at 等に既定値を埋める理由も無い
// （実運用では handle_new_user トリガが created_at/updated_at を指定せず INSERT するため
// DEFAULT now() で必ず埋まり、gender も CHECK 制約下の4値のいずれかしか書き込まれない。
// null になり得るのは型システム上の可能性であって、値を偽造せず素直に DB 行の型を返す）。
// getUserProfile() の戻り値型を実際に select('*') が返す DB 行の型（Row 型）に変更し、
// 実行時の挙動（`return data` そのもの）は一切変えずに型だけを実態に正直にする。
export async function getUserProfile(): Promise<Database['public']['Tables']['profiles']['Row'] | null> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  return data;
}

export async function updateUserProfile(
  updates: Partial<Pick<Profile, 'display_name' | 'phone' | 'prefecture' | 'city' | 'birth_date' | 'gender'>>
): Promise<{ error: string | null }> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: '認証が必要です' };

  const { error } = await supabase
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', user.id);

  return { error: error?.message ?? null };
}

export async function getUserFavorites(): Promise<(Favorite & { facility: FacilityCardData | null })[]> {
  try {
    const supabase = await createServerSupabaseAuthClient();
    const identity = await verifyAuthUser(supabase.auth);
    if (identity.state === 'unavailable') throw new Error('FAVORITES_UNAVAILABLE');
    if (identity.state === 'unauthenticated') return [];
    const user = identity.user;

    const { data, error } = await supabase
      .from('favorites')
      .select(`
        *,
        facility:facility_profiles (
          id, slug, name, business_type, catch_copy,
          prefecture, city, access_info,
          rating_avg, rating_count, main_photo_url
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw new Error('FAVORITES_UNAVAILABLE');
    return (data ?? []) as (Favorite & { facility: FacilityCardData | null })[];
  } catch {
    throw new Error('FAVORITES_UNAVAILABLE');
  }
}

export async function toggleFavorite(facilityId: string): Promise<{ isFavorited: boolean; error: string | null }> {
  try {
    const supabase = await createServerSupabaseAuthClient();
    const identity = await verifyAuthUser(supabase.auth);
    if (identity.state === 'unauthenticated') return { isFavorited: false, error: '認証が必要です' };
    if (identity.state !== 'verified') return { isFavorited: false, error: 'お気に入りを確認できません' };
    const { data, error } = await createServiceRoleClient().rpc('toggle_user_favorite_atomic', {
      p_actor_id: identity.user.id, p_facility_id: facilityId,
    });
    if (error || typeof data !== 'boolean') return { isFavorited: false, error: 'お気に入りを変更できません' };
    return { isFavorited: data, error: null };
  } catch {
    return { isFavorited: false, error: 'お気に入りを変更できません' };
  }
}

export async function checkFavorite(facilityId: string): Promise<boolean> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase
    .from('favorites')
    .select('id')
    .eq('user_id', user.id)
    .eq('facility_id', facilityId)
    .maybeSingle();

  return !!data;
}
