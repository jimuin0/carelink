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
