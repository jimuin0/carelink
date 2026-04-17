import type { Metadata } from 'next';
import Link from 'next/link';
import Breadcrumb from '@/components/Breadcrumb';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { articles } from '@/data/articles';

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

interface DbPost {
  slug: string;
  title: string;
  description: string;
  category: string;
  reading_time: number;
  published_at: string | null;
}

interface DisplayPost {
  slug: string;
  title: string;
  description: string;
  category: string;
  readingTime: number;
  publishedAt: string;
}

async function getPosts(): Promise<DisplayPost[]> {
  try {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase
      .from('platform_blog_posts')
      .select('slug, title, description, category, reading_time, published_at')
      .eq('is_published', true)
      .order('published_at', { ascending: false });

    if (data && data.length > 0) {
      return (data as DbPost[]).map((p) => ({
        slug: p.slug,
        title: p.title,
        description: p.description,
        category: p.category,
        readingTime: p.reading_time,
        publishedAt: p.published_at?.split('T')[0] ?? '',
      }));
    }
  } catch {
    // DBエラー時は静的データにフォールバック
  }

  // フォールバック: 静的データ
  return articles.map((a) => ({
    slug: a.slug,
    title: a.title,
    description: a.description,
    category: a.category,
    readingTime: a.readingTime,
    publishedAt: a.publishedAt,
  }));
}

export default async function BlogPage() {
  const posts = await getPosts();

  return (
    <div className="section-container">
      <Breadcrumb items={[{ label: 'ホーム', href: '/' }, { label: 'コラム' }]} />
      <h1 className="text-2xl sm:text-3xl font-bold mb-8">コラム</h1>
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
    </div>
  );
}
