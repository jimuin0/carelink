import { createServerSupabaseClient } from './supabase-server';
import { isMissingColumnError, warnMissingColumnFallback } from './db-fallback';
import type { BlogPost } from '@/types';

// 予約掲載(#34): scheduled_at が未設定 or 到来済みの投稿のみ公開（未来の予約投稿は時刻到来まで非表示）
function scheduledFilter(): string {
  return `scheduled_at.is.null,scheduled_at.lte.${new Date().toISOString()}`;
}

// scheduled_at 列が未適用の環境でも記事が全件消えないよう、JS 側で予約判定する（列が無い行は undefined=公開扱い）
function notFutureScheduled(p: BlogPost): boolean {
  const s = (p as { scheduled_at?: string | null }).scheduled_at;
  return s == null || new Date(s).getTime() <= Date.now();
}

export async function getBlogsByFacility(facilityId: string): Promise<BlogPost[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('facility_id', facilityId)
    .eq('is_published', true)
    .or(scheduledFilter())
    .order('published_at', { ascending: false });
  // scheduled_at 列が未適用なら .or() 無しで再取得し JS 側で予約判定（書込側 route.ts と対称な部分適用耐性）
  if (isMissingColumnError(error)) {
    warnMissingColumnFallback('blog_posts.read');
    const retry = await supabase
      .from('blog_posts')
      .select('*')
      .eq('facility_id', facilityId)
      .eq('is_published', true)
      .order('published_at', { ascending: false });
    return ((retry.data ?? []) as BlogPost[]).filter(notFutureScheduled);
  }
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
    .or(scheduledFilter())
    .single();
  if (isMissingColumnError(error)) {
    warnMissingColumnFallback('blog_posts.read');
    const retry = await supabase
      .from('blog_posts')
      .select('*')
      .eq('facility_id', facilityId)
      .eq('slug', slug)
      .eq('is_published', true)
      .single();
    const post = retry.data as BlogPost | null;
    return post && notFutureScheduled(post) ? post : null;
  }
  return data as BlogPost | null;
}
