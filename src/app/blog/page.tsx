import type { Metadata } from 'next';
import Link from 'next/link';
import Breadcrumb from '@/components/Breadcrumb';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { articles } from '@/data/articles';
import { safeCaptureException } from '@/lib/safe';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'コラム｜美容・健康の役立つ情報',
  description: '美容サロン・鍼灸院の利用ガイドや最新トレンド情報をお届け。初めてのサロン選びからケア方法まで役立つコラムが満載です。',
  alternates: { canonical: '/blog' },
  openGraph: {
    title: 'コラム｜美容・健康の役立つ情報 | CareLink',
    description: '美容サロン・鍼灸院の利用ガイドや最新トレンド情報をお届け。',
    type: 'website',
  },
};

interface SearchParams {
  tag?: string;
}

interface DbPost {
  slug: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  reading_time: number;
  published_at: string | null;
}

interface DisplayPost {
  slug: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  readingTime: number;
  publishedAt: string;
}

async function getPosts(tag?: string): Promise<DisplayPost[]> {
  try {
    const supabase = createServerSupabaseClient();
    let query = supabase
      .from('platform_blog_posts')
      .select('slug, title, description, category, tags, reading_time, published_at')
      .eq('is_published', true)
      .order('published_at', { ascending: false });

    if (tag) {
      query = query.contains('tags', [tag]);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[blog] 記事一覧の取得に失敗', { err: error.message });
      safeCaptureException(new Error(`platform_blog_posts fetch failed: ${error.message}`), 'blog:getPosts');
    } else if (data && data.length > 0) {
      return (data as DbPost[]).map((p) => ({
        slug: p.slug,
        title: p.title,
        description: p.description,
        category: p.category,
        tags: p.tags || [],
        readingTime: p.reading_time,
        publishedAt: p.published_at?.split('T')[0] ?? '',
      }));
    }
  } catch (err) {
    console.error('[blog] 記事一覧の取得で例外が発生', { err: err instanceof Error ? err.message : String(err) });
    safeCaptureException(err, 'blog:getPosts');
  }

  // フォールバック: 静的データ
  const fallback = articles.map((a) => ({
    slug: a.slug,
    title: a.title,
    description: a.description,
    category: a.category,
    tags: a.tags,
    readingTime: a.readingTime,
    publishedAt: a.publishedAt,
  }));
  return tag ? fallback.filter((a) => a.tags.includes(tag)) : fallback;
}

export default async function BlogPage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const tag = searchParams.tag;
  const posts = await getPosts(tag);

  return (
    <div className="section-container">
      <Breadcrumb items={[{ label: 'ホーム', href: '/' }, { label: 'コラム' }]} />
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold">コラム</h1>
        {tag && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-gray-600">タグ：{tag} の記事</span>
            <Link href="/blog" className="text-emerald-600 hover:underline">
              絞り込みを解除
            </Link>
          </div>
        )}
      </div>
      {posts.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-16">
          {tag ? `「${tag}」に該当する記事がありません` : '記事がありません'}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {posts.map((a) => (
            <Link key={a.slug} href={`/blog/${a.slug}`} className="card hover:shadow-lg transition-shadow group">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-medium px-2 py-1 rounded-full bg-emerald-50 text-emerald-600">{a.category}</span>
                <span className="text-xs text-gray-400">{a.readingTime}分で読める</span>
              </div>
              <h2 className="font-bold text-lg mb-2 group-hover:text-emerald-600 transition-colors leading-snug">{a.title}</h2>
              <p className="text-gray-500 text-sm leading-relaxed line-clamp-3">{a.description}</p>
              <p className="text-gray-400 text-xs mt-4">{a.publishedAt}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
