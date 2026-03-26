import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Breadcrumb from '@/components/Breadcrumb';
import { articles, type ArticleSection } from '@/data/articles';

export function generateStaticParams() {
  return articles.map((a) => ({ slug: a.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const article = articles.find((a) => a.slug === params.slug);
  if (!article) return {};
  return {
    title: article.title,
    description: article.description,
    openGraph: { title: article.title, description: article.description, type: 'article', publishedTime: article.publishedAt },
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
      const colors = { tip: 'bg-green-50 border-green-300 text-green-800', warning: 'bg-amber-50 border-amber-300 text-amber-800', info: 'bg-emerald-50 border-emerald-300 text-emerald-800' };
      const icons = { tip: '\u{1F4A1}', warning: '\u26A0\uFE0F', info: '\u2139\uFE0F' };
      const t = section.calloutType || 'info';
      return (
        <div key={i} className={`border-l-4 p-4 rounded-r-lg mb-4 ${colors[t]}`}>
          <span className="mr-2">{icons[t]}</span>{section.text}
        </div>
      );
    }
  }
}

export default function ArticlePage({ params }: { params: { slug: string } }) {
  const article = articles.find((a) => a.slug === params.slug);
  if (!article) notFound();

  const related = articles.filter((a) => a.slug !== article.slug && a.category === article.category).slice(0, 2);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.description,
    datePublished: article.publishedAt,
    author: { '@type': 'Organization', name: 'CareLink' },
    publisher: { '@type': 'Organization', name: 'CareLink' },
  };

  return (
    <div className="section-container">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Breadcrumb items={[{ label: 'ホーム', href: '/' }, { label: 'コラム', href: '/blog' }, { label: article.title }]} />

      <article className="max-w-3xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs font-medium px-2 py-1 rounded-full bg-emerald-50 text-emerald-600">{article.category}</span>
            <span className="text-sm text-gray-400">{article.publishedAt}</span>
            <span className="text-sm text-gray-400">{article.readingTime}分で読める</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold leading-tight">{article.title}</h1>
        </div>

        <div className="prose-like">
          {article.content.map((section, i) => renderSection(section, i))}
        </div>

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
