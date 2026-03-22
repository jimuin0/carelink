import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getFacilityBySlug } from '@/lib/facilities';
import { getBlogPost } from '@/lib/blog';

interface Props {
  params: { slug: string; postSlug: string };
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

          <div className="mt-6 prose prose-sm max-w-none whitespace-pre-wrap text-gray-700 leading-relaxed">
            {post.content}
          </div>
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
