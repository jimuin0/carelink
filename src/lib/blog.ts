import { createServerSupabaseClient } from './supabase-server';
import type { BlogPost } from '@/types';

// 予約掲載(#34): scheduled_at が未設定 or 到来済みの投稿のみ公開（未来の予約投稿は時刻到来まで非表示）
function scheduledFilter(): string {
  return `scheduled_at.is.null,scheduled_at.lte.${new Date().toISOString()}`;
}

export async function getBlogsByFacility(facilityId: string): Promise<BlogPost[]> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('facility_id', facilityId)
    .eq('is_published', true)
    .or(scheduledFilter())
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
    .or(scheduledFilter())
    .single();
  return data as BlogPost | null;
}
