import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getFeatureBySlug } from '@/lib/features';
import { searchFacilities } from '@/lib/facilities';
import Breadcrumb from '@/components/Breadcrumb';
import FacilityCard from '@/components/search/FacilityCard';

export const revalidate = 3600;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const feature = await getFeatureBySlug(slug);
  if (!feature) return {};

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.carelink-jp.com';
  return {
    title: feature.title,
    description: feature.description || `${feature.title} | CareLink 特集`,
    alternates: { canonical: `${baseUrl}/feature/${slug}` },
    openGraph: {
      title: `${feature.title} | CareLink`,
      description: feature.description || undefined,
      images: feature.banner_image_url
        ? [{ url: feature.banner_image_url }]
        : [{ url: `${baseUrl}/api/og?title=${encodeURIComponent(feature.title)}&subtitle=${encodeURIComponent('特集')}` }],
    },
  };
}

export default async function FeatureDetailPage({ params }: Props) {
  const { slug } = await params;
  const feature = await getFeatureBySlug(slug);
  if (!feature) notFound();

  // 関連施設を取得
  const { facilities } = await searchFacilities({
    type: feature.filter_type || undefined,
    keyword: feature.filter_keyword || undefined,
    prefecture: feature.filter_prefecture || undefined,
    sort: 'rating',
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Breadcrumb
          items={[
            { label: 'トップ', href: '/' },
            { label: '特集一覧', href: '/feature' },
            { label: feature.title },
          ]}
        />

        {/* ヒーローバナー */}
        {feature.banner_image_url && (
          <div className="relative aspect-[3/1] rounded-2xl overflow-hidden mb-8">
            <Image
              src={feature.banner_image_url}
              alt={feature.title}
              fill
              sizes="100vw"
              className="object-cover"
              priority
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8">
              <h1 className="text-2xl sm:text-3xl font-bold text-white">{feature.title}</h1>
              {feature.description && (
                <p className="text-white/80 text-sm mt-2">{feature.description}</p>
              )}
            </div>
          </div>
        )}

        {!feature.banner_image_url && (
          <div className="mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{feature.title}</h1>
            {feature.description && (
              <p className="text-gray-600 text-sm mt-2">{feature.description}</p>
            )}
          </div>
        )}

        {/* CTA ボックス */}
        <div className="bg-sky-50 border border-sky-100 rounded-2xl p-6 mb-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-gray-800">{feature.title}のサロンを今すぐチェック</p>
            <p className="text-xs text-gray-500 mt-1">条件にぴったりのサロンが見つかります</p>
          </div>
          <Link
            href={`/search?${feature.filter_type ? `type=${encodeURIComponent(feature.filter_type)}` : ''}${feature.filter_keyword ? `&keyword=${encodeURIComponent(feature.filter_keyword)}` : ''}`}
            className="inline-flex items-center gap-2 px-6 py-3 bg-sky-500 hover:bg-sky-600 text-white font-bold rounded-xl text-sm transition-colors whitespace-nowrap"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            サロンを探す
          </Link>
        </div>

        {/* コンテンツセクション */}
        {feature.content && Array.isArray(feature.content) && feature.content.length > 0 && (
          <div className="bg-white rounded-2xl p-6 sm:p-8 mb-10 space-y-6">
            {feature.content.map((section: { heading: string; body: string; image_url?: string }, i: number) => (
              <div key={i}>
                <h2 className="text-lg font-bold text-gray-900 mb-2">{section.heading}</h2>
                {section.image_url && (
                  <div className="relative aspect-[16/9] rounded-xl overflow-hidden mb-3">
                    <Image src={section.image_url} alt={section.heading} fill sizes="(max-width: 768px) 100vw, 800px" className="object-cover" />
                  </div>
                )}
                <p className="text-sm text-gray-600 leading-relaxed">{section.body}</p>
              </div>
            ))}
          </div>
        )}

        {/* 関連施設 */}
        {facilities.length > 0 && (
          <section>
            <h2 className="text-sm font-bold text-gray-800 mb-4 pl-3 border-l-[3px] border-sky-500">
              この特集に関連する施設
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {facilities.slice(0, 9).map((f) => (
                <FacilityCard key={f.id} facility={f} />
              ))}
            </div>
            <div className="text-center mt-8">
              <Link
                href={`/search?${feature.filter_type ? `type=${encodeURIComponent(feature.filter_type)}` : ''}${feature.filter_keyword ? `&keyword=${encodeURIComponent(feature.filter_keyword)}` : ''}`}
                className="inline-flex items-center gap-2 px-8 py-3.5 bg-sky-500 hover:bg-sky-600 text-white font-bold rounded-xl text-sm transition-colors shadow-md hover:shadow-lg"
              >
                すべての施設を見る
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </Link>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
