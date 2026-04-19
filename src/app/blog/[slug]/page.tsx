import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Breadcrumb from '@/components/Breadcrumb';
import { articles, type ArticleSection } from '@/data/articles';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { safeJsonLd } from '@/lib/json-ld';

export const revalidate = 3600;

interface DbPost {
  slug: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  reading_time: number;
  content: ArticleSection[];
  published_at: string | null;
  author_name: string;
}

async function getPost(slug: string): Promise<DbPost | null> {
  try {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase
      .from('platform_blog_posts')
      .select('slug, title, description, category, tags, reading_time, content, published_at, author_name')
      .eq('slug', slug)
      .eq('is_published', true)
      .single();
    if (data) return data as DbPost;
  } catch {
    // フォールバックへ
  }

  // 静的データからフォールバック
  const a = articles.find((a) => a.slug === slug);
  if (!a) return null;
  return {
    slug: a.slug,
    title: a.title,
    description: a.description,
    category: a.category,
    tags: a.tags,
    reading_time: a.readingTime,
    content: a.content,
    published_at: a.publishedAt,
    author_name: 'CareLink編集部',
  };
}

async function getRelated(slug: string, category: string): Promise<{ slug: string; title: string; category: string }[]> {
  try {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase
      .from('platform_blog_posts')
      .select('slug, title, category')
      .eq('is_published', true)
      .eq('category', category)
      .neq('slug', slug)
      .limit(2);
    if (data && data.length > 0) return data;
  } catch { /* noop */ }

  return articles
    .filter((a) => a.slug !== slug && a.category === category)
    .slice(0, 2)
    .map((a) => ({ slug: a.slug, title: a.title, category: a.category }));
}

export async function generateStaticParams() {
  try {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase
      .from('platform_blog_posts')
      .select('slug')
      .eq('is_published', true);
    if (data && data.length > 0) return data.map((p) => ({ slug: p.slug }));
  } catch { /* noop */ }
  return articles.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const params = await props.params;
  const post = await getPost(params.slug);
  if (!post) return {};
  const publishedAt = post.published_at?.split('T')[0] ?? '';
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${params.slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      type: 'article',
      publishedTime: publishedAt,
      images: [{ url: `/api/og?title=${encodeURIComponent(post.title.slice(0, 50))}`, width: 1200, height: 630 }],
    },
  };
}

function renderSection(section: ArticleSection, i: number) {
  switch (section.type) {
    case 'heading':
      return <h2 key={i} className="text-xl font-bold mt-8 mb-4">{section.heading}</h2>;
    case 'paragraph':
      return <p key={i} className="text-gray-700 leading-relaxed mb-4 whitespace-pre-line">{section.text}</p>;
    case 'list':
      return (
        <ul key={i} className="list-disc list-inside space-y-2 mb-4 text-gray-700">
          {section.items?.map((item, j) => <li key={j}>{item}</li>)}
        </ul>
      );
    case 'callout': {
      const colors = {
        tip: 'bg-green-50 border-green-300 text-green-800',
        warning: 'bg-amber-50 border-amber-300 text-amber-800',
        info: 'bg-emerald-50 border-emerald-300 text-emerald-800',
      };
      const icons = { tip: '💡', warning: '⚠️', info: 'ℹ️' };
      const t = section.calloutType || 'info';
      return (
        <div key={i} className={`border-l-4 p-4 rounded-r-lg mb-4 ${colors[t]}`}>
          <span className="mr-2">{icons[t]}</span>{section.text}
        </div>
      );
    }
  }
}

export default async function ArticlePage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const post = await getPost(params.slug);
  if (!post) notFound();

  const related = await getRelated(params.slug, post.category);
  const publishedAt = post.published_at?.split('T')[0] ?? '';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: publishedAt,
    dateModified: publishedAt,
    author: { '@type': 'Organization', name: 'CareLink', url: 'https://carelink-jp.com' },
    publisher: { '@type': 'Organization', name: 'CareLink', url: 'https://carelink-jp.com' },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `https://carelink-jp.com/blog/${post.slug}` },
    inLanguage: 'ja',
    ...(post.tags.length > 0 && { keywords: post.tags.join(', ') }),
  };

  return (
    <div className="section-container">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
      <Breadcrumb items={[{ label: 'ホーム', href: '/' }, { label: 'コラム', href: '/blog' }, { label: post.title }]} />
      <article className="max-w-3xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <span className="text-xs font-medium px-2 py-1 rounded-full bg-emerald-50 text-emerald-600">{post.category}</span>
            <span className="text-sm text-gray-400">{publishedAt}</span>
            <span className="text-sm text-gray-400">{post.reading_time}分で読める</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold leading-tight">{post.title}</h1>
          {post.author_name && (
            <p className="text-xs text-gray-400 mt-2">著者: {post.author_name}</p>
          )}
        </div>

        <div className="prose-like">
          {(post.content as ArticleSection[]).map((section, i) => renderSection(section, i))}
        </div>

        {/* タグ */}
        {post.tags.length > 0 && (
          <div className="mt-8 flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <Link
                key={tag}
                href={`/blog?tag=${encodeURIComponent(tag)}`}
                className="text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded-full hover:bg-gray-200 transition-colors"
              >
                #{tag}
              </Link>
            ))}
          </div>
        )}

        {/* CTA */}
        <div className="mt-12 p-6 sm:p-8 rounded-2xl text-center text-white" style={{ backgroundColor: 'var(--primary)' }}>
          <p className="text-lg font-bold mb-2">あなたに合った施設を見つけませんか？</p>
          <p className="text-white/80 text-sm mb-4">CareLinkなら完全無料で施設を検索・予約できます</p>
          <Link href="/register" className="inline-block px-8 py-3 bg-white font-bold rounded-lg transition-all hover:bg-gray-100" style={{ color: 'var(--primary)' }}>
            無料で登録する
          </Link>
        </div>

        {/* Related */}
        {related.length > 0 && (
          <div className="mt-12">
            <h3 className="text-lg font-bold mb-4">関連記事</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              {related.map((r) => (
                <Link key={r.slug} href={`/blog/${r.slug}`} className="card hover:shadow-md transition-shadow text-sm">
                  <span className="text-xs text-emerald-600 font-medium">{r.category}</span>
                  <p className="font-bold mt-1">{r.title}</p>
                </Link>
              ))}
            </div>
          </div>
        )}
      </article>
    </div>
  );
}
