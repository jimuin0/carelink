import { createServerSupabaseClient } from './supabase-server';
import type { BlogPost } from '@/types';

/** API adapters/legacy rows cannot put objects or null into article tags. */
export function normalizeBlogTags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export async function getBlogsByFacility(facilityId: string): Promise<BlogPost[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('facility_id', facilityId)
    .eq('is_published', true)
    .order('published_at', { ascending: false });
  if (error) throw new Error('Blog list unavailable');
  return (data ?? []) as BlogPost[];
}

export type BlogPostSummary = Pick<BlogPost, 'id' | 'slug' | 'title' | 'published_at'>;

/**
 * 施設ページに出す「新着ブログ」用。本文（content）は読まずに、新しい順の先頭 limit 件と総数だけ返す
 * （2026年10月22日 新設）。
 *
 * 店舗が公開した記事は施設ページにも sitemap にも導線が無く、来訪者からも検索エンジンからも
 * 辿れなかった。施設ページは閲覧のたびに描画されるため、記事数に比例して重くならないよう
 * 件数を絞り、総数は count で取る。読み取りに失敗したら例外にする（呼び出し側が導線を出さない）。
 */
export async function getBlogSummariesByFacility(
  facilityId: string,
  limit: number,
): Promise<{ posts: BlogPostSummary[]; total: number }> {
  const supabase = createServerSupabaseClient();
  const { data, error, count } = await supabase
    .from('blog_posts')
    .select('id, slug, title, published_at', { count: 'exact' })
    .eq('facility_id', facilityId)
    .eq('is_published', true)
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(limit);
  if (error || !Array.isArray(data)) throw new Error('Blog list unavailable');
  return { posts: data, total: Math.max(count ?? 0, data.length) };
}

export async function getBlogPost(facilityId: string, slug: string): Promise<BlogPost | null> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('facility_id', facilityId)
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle();
  if (error) throw new Error('Blog unavailable');
  return data as BlogPost | null;
}
