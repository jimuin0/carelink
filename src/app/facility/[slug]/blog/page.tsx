import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getFacilityBySlug } from '@/lib/facilities';
import { getBlogsByFacility } from '@/lib/blog';

export const revalidate = 3600;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const { facility } = await getFacilityBySlug(params.slug);
  if (!facility) return {};
  // ルート layout の title.template '%s | CareLink' が自動付与するため、
  // metadata.title には「| CareLink」を付けない（付けると二重化する）。openGraph.title はテンプレ非適用のため付与する。
  const title = `ブログ | ${facility.name}`;
  const description = `${facility.name}のブログ記事一覧。最新情報やお役立ち情報をお届けします。`;
  return {
    title,
    description,
    alternates: { canonical: `/facility/${params.slug}/blog` },
    openGraph: { title: `${title} | CareLink`, description },
  };
}

export default async function FacilityBlogPage(props: Props) {
  const params = await props.params;
  const { facility } = await getFacilityBySlug(params.slug);
  if (!facility) notFound();

  const posts = await getBlogsByFacility(facility.id);

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto bg-white shadow-sm">
        <nav className="px-4 sm:px-6 pt-3 pb-1" aria-label="パンくずリスト">
          <ol className="flex items-center gap-1.5 text-xs text-gray-400">
            {/* 他ページのパンくず「トップ」は全て / を指す（facility/[slug]/page.tsx等）。
                このページのみ /search になっていた表記ゆれを統一する（2026年7月8日 恒久根治）。 */}
            <li><Link href="/" className="hover:text-sky-600">トップ</Link></li>
            <li><span className="mx-1">/</span></li>
            <li><Link href={`/facility/${params.slug}`} className="hover:text-sky-600">{facility.name}</Link></li>
            <li><span className="mx-1">/</span></li>
            <li className="text-gray-600 font-medium">ブログ</li>
          </ol>
        </nav>

        <div className="px-4 sm:px-6 py-6">
          <h1 className="text-xl font-bold mb-6">ブログ</h1>

          {posts.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-400 text-sm">ブログ記事がまだありません</p>
            </div>
          ) : (
            <div className="space-y-4">
              {posts.map((post) => (
                <Link
                  key={post.id}
                  href={`/facility/${params.slug}/blog/${post.slug}`}
                  className="block bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-md transition-shadow"
                >
                  <div className="flex">
                    {post.thumbnail_url && (
                      <div className="relative w-28 h-28 sm:w-36 sm:h-36 shrink-0 bg-gray-100">
                        <Image src={post.thumbnail_url} alt={post.title} fill sizes="144px" className="object-cover" />
                      </div>
                    )}
                    <div className="p-4 flex-1">
                      <p className="font-bold text-sm line-clamp-2">{post.title}</p>
                      <p className="text-xs text-gray-400 mt-2">
                        {post.published_at ? new Date(post.published_at).toLocaleDateString('ja-JP') : ''}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
