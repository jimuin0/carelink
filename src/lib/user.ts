import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import type { Profile, Favorite, FacilityCardData } from '@/types';

export async function getUserProfile(): Promise<Profile | null> {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return data;
}

export async function updateUserProfile(
  updates: Partial<Pick<Profile, 'display_name' | 'phone' | 'prefecture' | 'city' | 'birth_date' | 'gender'>>
): Promise<{ error: string | null }> {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: '認証が必要です' };

  const { error } = await supabase
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', user.id);

  return { error: error?.message ?? null };
}

export async function getUserFavorites(): Promise<(Favorite & { facility: FacilityCardData })[]> {
  const supabase = createServerSupabaseAuthClient();
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
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { isFavorited: false, error: '認証が必要です' };

  const { data: existing } = await supabase
    .from('favorites')
    .select('id')
    .eq('user_id', user.id)
    .eq('facility_id', facilityId)
    .single();

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
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase
    .from('favorites')
    .select('id')
    .eq('user_id', user.id)
    .eq('facility_id', facilityId)
    .single();

  return !!data;
}
