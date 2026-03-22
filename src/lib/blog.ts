import { createServerSupabaseClient } from './supabase-server';
import type { BlogPost } from '@/types';

export async function getBlogsByFacility(facilityId: string): Promise<BlogPost[]> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('facility_id', facilityId)
    .eq('is_published', true)
    .order('published_at', { ascending: false });
  return (data ?? []) as BlogPost[];
}

export async function getBlogPost(facilityId: string, slug: string): Promise<BlogPost | null> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('facility_id', facilityId)
    .eq('slug', slug)
    .eq('is_published', true)
    .single();
  return data as BlogPost | null;
}
