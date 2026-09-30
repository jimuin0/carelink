import { createServerSupabaseClient } from './supabase-server';
import { prefectures } from './constants';
import type { Area } from '@/types';

/**
 * エリアタイプに応じた searchFacilities 用のフィルタパラメータを組み立てる純粋関数
 * （テスト容易化のため分離）。
 * 【2026年7月8日 恒久根治】city タイプは従来 keyword（name/catch_copy/description/city/
 * nearest_station への曖昧ILIKE検索）を使っており、市区町村名が説明文等に偶然含まれる
 * 無関係施設が混入したり、city 列の表記が area.name と完全一致しない施設を取りこぼす
 * 可能性があった。searchFacilities がサポートする city 列の完全一致フィルタに変更する。
 */
export type AreaSearchScope =
  | { kind: 'prefecture'; prefecture: string }
  | { kind: 'city'; prefecture: string; city: string }
  | { kind: 'station'; prefecture: string; city?: string; station: string }
  | { kind: 'region'; prefectures: string[] };

/** Names alone do not establish geography; invalid ancestry never means all Japan. */
export function buildAreaSearchParam(area: Area, breadcrumb: Area[], children: Area[]): AreaSearchScope {
  if (breadcrumb.at(-1)?.id !== area.id || new Set(breadcrumb.map(item => item.id)).size !== breadcrumb.length
    || breadcrumb[0].parent_id !== null) throw new Error('Area hierarchy is incomplete');
  const allowedParents: Record<Area['area_type'], Area['area_type'][]> = {
    region: [], prefecture: ['region'], city: ['prefecture'], station: ['city', 'prefecture'],
  };
  for (let index = 1; index < breadcrumb.length; index++) {
    const parent = breadcrumb[index - 1]; const child = breadcrumb[index];
    if (child.parent_id !== parent.id || !allowedParents[child.area_type].includes(parent.area_type)) {
      throw new Error('Area hierarchy type or link is invalid');
    }
  }
  if (area.area_type === 'region') {
    if (children.some(child => child.parent_id !== area.id || child.area_type !== 'prefecture'
      || !prefectures.includes(child.name))) throw new Error('Area region hierarchy is invalid');
    return { kind: 'region', prefectures: [...new Set(children.map(child => child.name))] };
  }
  const parents = breadcrumb.filter(item => item.area_type === 'prefecture');
  if (parents.length !== 1 || !prefectures.includes(parents[0].name)) throw new Error('Area prefecture scope is unavailable');
  const prefecture = parents[0].name;
  const hasRegion = breadcrumb[0].area_type === 'region';
  if (area.area_type === 'prefecture') {
    if (!hasRegion || breadcrumb.length !== 2 || parents[0].id !== area.id) throw new Error('Area prefecture hierarchy is invalid');
    return { kind: 'prefecture', prefecture };
  }
  if (area.area_type === 'city') {
    if (!hasRegion || breadcrumb.length !== 3 || breadcrumb.at(-2)?.area_type !== 'prefecture') {
      throw new Error('Area city hierarchy is invalid');
    }
    return { kind: 'city', prefecture, city: area.name };
  }
  const city = breadcrumb.find(item => item.area_type === 'city');
  // The link loop above already constrains a station's direct parent to city or prefecture.
  if (!hasRegion) throw new Error('Area station hierarchy is invalid');
  return { kind: 'station', prefecture, ...(city ? { city: city.name } : {}), station: area.name };
}

export async function getAreasByParent(parentId: string | null): Promise<Area[]> {
  const supabase = createServerSupabaseClient();
  let query = supabase
    .from('areas')
    .select('*', { count: 'exact' })
    .order('sort_order').order('id');

  if (parentId) {
    query = query.eq('parent_id', parentId);
  } else {
    query = query.is('parent_id', null);
  }

  const { data, error, count } = await query;
  if (error || !Array.isArray(data) || count !== data.length) throw new Error('Area list unavailable or truncated');
  return data as Area[];
}

export async function getAreaBySlug(slug: string): Promise<Area | null> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('areas')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error('Area lookup unavailable');
  return data as Area | null;
}

export async function getAreaBreadcrumb(area: Area): Promise<Area[]> {
  const supabase = createServerSupabaseClient();

  const breadcrumb: Area[] = [area];
  const visited = new Set([area.id]);
  let currentId = area.parent_id;
  while (currentId) {
    if (visited.has(currentId) || breadcrumb.length >= 16) throw new Error('Area hierarchy cycle or depth limit');
    visited.add(currentId);
    // Fetch by PK, not an all-areas query subject to the API's row limit.
    const { data, error } = await supabase.from('areas').select('*').eq('id', currentId).maybeSingle();
    if (error || !data || data.id !== currentId) throw new Error('Area ancestor unavailable');
    breadcrumb.unshift(data as Area);
    currentId = data.parent_id;
  }
  return breadcrumb;
}
