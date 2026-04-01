import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getFacilityBySlug } from '@/lib/facilities';
import { getBlogPost } from '@/lib/blog';

export const revalidate = 3600;

export async function generateStaticParams() {
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

function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/')) return trimmed;
  return '#';
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderMarkdown(text: string): string {
  // 1. HTML特殊文字を先にエスケープ（XSS防止の基盤）
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // 2. マークダウン変換（エスケープ済みテキストに対して安全に適用）
  html = html
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\[(.+?)\]\((.+?)\)/g, (_, label, url) => `<a href="${escapeAttr(sanitizeUrl(url))}" class="text-sky-600 underline" rel="noopener noreferrer">${label}</a>`)
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  // 3. 連続した<li>をまとめて<ul>でラップ
  html = html.replace(/(<li>.*?<\/li>(?:<br>)?)+/g, (match) => {
    return '<ul>' + match.replace(/<br>/g, '') + '</ul>';
  });

  return '<p>' + html + '</p>';
}

interface Props {
  params: { slug: string; postSlug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { facility } = await getFacilityBySlug(params.slug);
  if (!facility) return {};
  const post = await getBlogPost(facility.id, params.postSlug);
  if (!post) return {};
  const title = `${post.title} | ${facility.name} | CareLink`;
  const description = post.content.slice(0, 120);
  return {
    title,
    description,
    alternates: { canonical: `/facility/${params.slug}/blog/${params.postSlug}` },
    openGraph: { title, description, type: 'article' },
  };
}

export default async function BlogDetailPage({ params }: Props) {
  const { facility } = await getFacilityBySlug(params.slug);
  if (!facility) notFound();

  const post = await getBlogPost(facility.id, params.postSlug);
  if (!post) notFound();

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto bg-white shadow-sm">
        <nav className="px-4 sm:px-6 pt-3 pb-1" aria-label="パンくずリスト">
          <ol className="flex items-center gap-1.5 text-xs text-gray-400">
            <li><Link href="/search" className="hover:text-sky-600">トップ</Link></li>
            <li><span className="mx-1">/</span></li>
            <li><Link href={`/facility/${params.slug}`} className="hover:text-sky-600">{facility.name}</Link></li>
            <li><span className="mx-1">/</span></li>
            <li><Link href={`/facility/${params.slug}/blog`} className="hover:text-sky-600">ブログ</Link></li>
            <li><span className="mx-1">/</span></li>
            <li className="text-gray-600 font-medium truncate max-w-[200px]">{post.title}</li>
          </ol>
        </nav>

        <article className="px-4 sm:px-6 py-6">
          <h1 className="text-xl sm:text-2xl font-bold leading-tight">{post.title}</h1>
          <p className="text-sm text-gray-400 mt-2">
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
            className="inline-flex items-center gap-1 text-sm text-sky-600 hover:underline"
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
