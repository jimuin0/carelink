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
  const supabase = createServerSupabaseClient();

  // Collect all parent IDs first, then fetch in a single query
  const parentIds: string[] = [];
  let currentId = area.parent_id;
  // Pre-fetch all areas to avoid N+1 (areas table is small)
  const { data: allAreas } = await supabase.from('areas').select('*');
  const areaMap = new Map((allAreas ?? []).map((a) => [a.id, a as Area]));

  let depth = 0;
  while (currentId && depth < 10) {
    parentIds.unshift(currentId);
    const parent = areaMap.get(currentId);
    if (!parent) break;
    currentId = parent.parent_id;
    depth++;
  }

  const breadcrumb: Area[] = parentIds
    .map((id) => areaMap.get(id))
    .filter((a): a is Area => !!a);
  breadcrumb.push(area);
  return breadcrumb;
}
