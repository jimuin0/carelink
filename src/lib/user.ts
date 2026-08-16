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

export async function getUserFavorites(): Promise<(Favorite & { facility: FacilityCardData })[]> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
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

  return (data ?? []) as (Favorite & { facility: FacilityCardData })[];
}

export async function toggleFavorite(facilityId: string): Promise<{ isFavorited: boolean; error: string | null }> {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { isFavorited: false, error: '認証が必要です' };

  const { data: existing } = await supabase
    .from('favorites')
    .select('id')
    .eq('user_id', user.id)
    .eq('facility_id', facilityId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('favorites')
      .delete()
      .eq('id', existing.id);
    return { isFavorited: false, error: error?.message ?? null };
  } else {
    const { error } = await supabase
      .from('favorites')
      .insert({ user_id: user.id, facility_id: facilityId });
    return { isFavorited: true, error: error?.message ?? null };
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
