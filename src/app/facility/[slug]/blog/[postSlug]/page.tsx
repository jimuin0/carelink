import { hasSupabasePublicEnv } from '@/lib/supabase-build-env';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getFacilityBySlug } from '@/lib/facilities';
import { getBlogPost } from '@/lib/blog';
import { safeJsonLd } from '@/lib/json-ld';
import { renderMarkdown } from '@/lib/facility-blog-markdown';

export const revalidate = 3600;

export async function generateStaticParams() {
  // Preview builds carry no Supabase credentials; render these on demand instead.
  if (!hasSupabasePublicEnv()) return [];
  const { createServerSupabaseClient } = await import('@/lib/supabase-server');
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('blog_posts')
    .select('slug, facility_id, facility_profiles!inner(slug)')
    .eq('is_published', true)
    .limit(200);
  return (data || []).map((p: Record<string, unknown>) => ({
    slug: (p.facility_profiles as { slug: string })?.slug,
    postSlug: p.slug as string,
  }));
}

interface Props {
  params: Promise<{ slug: string; postSlug: string }>;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const { facility } = await getFacilityBySlug(params.slug);
  if (!facility) return {};
  const post = await getBlogPost(facility.id, params.postSlug);
  if (!post) return {};
  // ルート layout の title.template '%s | CareLink' が自動付与するため、
  // metadata.title には「| CareLink」を付けない（付けると二重化する）。openGraph.title はテンプレ非適用のため付与する。
  const title = `${post.title} | ${facility.name}`;
  const description = post.content.slice(0, 120);
  return {
    title,
    description,
    alternates: { canonical: `/facility/${params.slug}/blog/${params.postSlug}` },
    openGraph: { title: `${title} | CareLink`, description, type: 'article' },
  };
}

export default async function BlogDetailPage(props: Props) {
  const params = await props.params;
  const { facility } = await getFacilityBySlug(params.slug);
  if (!facility) notFound();

  const post = await getBlogPost(facility.id, params.postSlug);
  if (!post) notFound();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.content.slice(0, 160),
    datePublished: post.published_at,
    dateModified: post.updated_at || post.published_at,
    author: { '@type': 'Organization', name: facility.name },
    publisher: { '@type': 'Organization', name: 'CareLink', url: 'https://carelink-jp.com' },
    mainEntityOfPage: `https://carelink-jp.com/facility/${params.slug}/blog/${params.postSlug}`,
    ...(post.thumbnail_url && { image: post.thumbnail_url }),
  };

  return (
    <div className="bg-gray-50 min-h-screen">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
      <div className="max-w-4xl mx-auto bg-white shadow-xs">
        <nav className="px-4 sm:px-6 pt-3 pb-1" aria-label="パンくずリスト">
          <ol className="crumbs flex items-center gap-1.5 text-xs text-gray-500">
            {/* 他ページのパンくず「トップ」は全て / を指す（facility/[slug]/page.tsx等）。
                このページのみ /search になっていた表記ゆれを統一する（2026年7月8日 恒久根治）。 */}
            <li><Link href="/" className="hover:text-sky-600">トップ</Link></li>
            <li><span className="mx-1">/</span></li>
            <li><Link href={`/facility/${params.slug}`} className="hover:text-sky-600">{facility.name}</Link></li>
            <li><span className="mx-1">/</span></li>
            <li><Link href={`/facility/${params.slug}/blog`} className="hover:text-sky-600">ブログ</Link></li>
            <li><span className="mx-1">/</span></li>
            <li className="text-gray-600 font-medium truncate max-w-[200px]">{post.title}</li>
          </ol>
        </nav>

        <article className="px-4 sm:px-6 py-6">
          <h1 className="jp-balance text-xl sm:text-2xl font-bold leading-tight">{post.title}</h1>
          <p className="text-sm text-gray-500 mt-2">
            {post.published_at ? new Date(post.published_at).toLocaleDateString('ja-JP') : ''}
          </p>

          <div
            className="mt-6 prose prose-sm max-w-none text-gray-700 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(post.content) }}
          />
        </article>

        <div className="px-4 sm:px-6 pb-8">
          <Link
            href={`/facility/${params.slug}/blog`}
            className="inline-flex items-center gap-1 text-sm text-sky-700 hover:underline"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            ブログ一覧に戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
