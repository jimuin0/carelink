import { createServerSupabaseClient } from './supabase-server';
import type { Area } from '@/types';

export async function getAreasByParent(parentId: string | null): Promise<Area[]> {
  const supabase = createServerSupabaseClient();
  let query = supabase
    .from('areas')
    .select('*')
    .order('sort_order');

  if (parentId) {
    query = query.eq('parent_id', parentId);
  } else {
    query = query.is('parent_id', null);
  }

  const { data } = await query;
  return (data ?? []) as Area[];
}

export async function getAreaBySlug(slug: string): Promise<Area | null> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('areas')
    .select('*')
    .eq('slug', slug)
    .single();
  return data as Area | null;
}

export async function getAreaBreadcrumb(area: Area): Promise<Area[]> {
  const breadcrumb: Area[] = [area];
  let current = area;

  while (current.parent_id) {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase
      .from('areas')
      .select('*')
      .eq('id', current.parent_id)
      .single();
    if (!data) break;
    breadcrumb.unshift(data as Area);
    current = data as Area;
  }

  return breadcrumb;
}
