import { createServerSupabaseClient } from './supabase-server';
import type { Area } from '@/types';

/**
 * エリアタイプに応じた searchFacilities 用のフィルタパラメータを組み立てる純粋関数
 * （テスト容易化のため分離）。
 * 【2026年7月8日 恒久根治】city タイプは従来 keyword（name/catch_copy/description/city/
 * nearest_station への曖昧ILIKE検索）を使っており、市区町村名が説明文等に偶然含まれる
 * 無関係施設が混入したり、city 列の表記が area.name と完全一致しない施設を取りこぼす
 * 可能性があった。searchFacilities がサポートする city 列の完全一致フィルタに変更する。
 */
export function buildAreaSearchParam(area: Pick<Area, 'area_type' | 'name'>): { prefecture?: string; city?: string } {
  if (area.area_type === 'prefecture') return { prefecture: area.name };
  if (area.area_type === 'city') return { city: area.name };
  return {};
}

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
