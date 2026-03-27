import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  allPrefectureSlugs,
  allBusinessTypeSlugs,
  getPrefectureName,
  getBusinessTypeName,
} from '@/lib/seo-constants';
import { regionGroups, facilityFeatures } from '@/lib/constants';
import { searchFacilities } from '@/lib/facilities';
import { getAreaSeoContent } from '@/lib/area-seo';
import Breadcrumb from '@/components/Breadcrumb';
import FacilityCard from '@/components/search/FacilityCard';
import Pagination from '@/components/search/Pagination';
import RelatedLinks from '@/components/seo/RelatedLinks';

export const revalidate = 3600;

interface Props {
  params: Promise<{ prefectureSlug: string; typeSlug: string }>;
  searchParams: Promise<{ page?: string }>;
}

export function generateStaticParams() {
  const params: { prefectureSlug: string; typeSlug: string }[] = [];
  for (const ps of allPrefectureSlugs) {
    for (const ts of allBusinessTypeSlugs) {
      params.push({ prefectureSlug: ps, typeSlug: ts });
    }
  }
  return params;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { prefectureSlug, typeSlug } = await params;
  const prefName = getPrefectureName(prefectureSlug);
  const typeName = getBusinessTypeName(typeSlug);
  if (!prefName || !typeName) return {};

  const title = `${prefName}の${typeName}`;
  const description = `${prefName}の${typeName}を口コミ・メニュー・写真で比較。ネット予約24時間OK。CareLink で${prefName}の${typeName}を探そう。`;

  return {
    title,
    description,
    openGraph: { title: `${title} | CareLink`, description },
    alternates: { canonical: `/${prefectureSlug}/${typeSlug}` },
  };
}

export default async function PrefectureTypePage({ params, searchParams }: Props) {
  const { prefectureSlug, typeSlug } = await params;
  const { page: pageStr } = await searchParams;
  const prefName = getPrefectureName(prefectureSlug);
  const typeName = getBusinessTypeName(typeSlug);
  if (!prefName || !typeName) notFound();

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://carelink-ruddy-psi.vercel.app';
  const page = Math.max(1, parseInt(pageStr || '1', 10) || 1);

  const [{ facilities, total, perPage }, seoContent] = await Promise.all([
    searchFacilities({ prefecture: prefName, type: typeName, sort: 'rating', page }),
    getAreaSeoContent(prefectureSlug, typeSlug),
  ]);
  const totalPages = Math.ceil(total / perPage);

  const regionGroup = regionGroups.find((r) => r.prefectures.includes(prefName));

  // ItemList JSON-LD
  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${prefName}の${typeName}`,
    numberOfItems: total,
    itemListElement: facilities.map((f, i) => ({
      '@type': 'ListItem',
      position: (page - 1) * perPage + i + 1,
      url: `${baseUrl}/facility/${f.slug}`,
      name: f.name,
    })),
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }} />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Breadcrumb
          items={[
            { label: 'トップ', href: '/' },
            { label: prefName, href: `/${prefectureSlug}` },
            { label: typeName },
          ]}
        />

        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
          {prefName}の{typeName}
        </h1>
        <p className="text-sm text-gray-500 mb-8">{total}件の施設が見つかりました</p>

        {/* こだわり条件 */}
        <div className="mb-8">
          <h2 className="text-sm font-bold text-gray-800 mb-3 pl-3 border-l-[3px] border-sky-500">
            こだわり条件で絞り込む
          </h2>
          <div className="flex flex-wrap gap-2">
            {facilityFeatures.map((feature) => (
              <Link
                key={feature}
                href={`/search?type=${encodeURIComponent(typeName)}&area=${encodeURIComponent(prefName)}&keyword=${encodeURIComponent(feature)}`}
                className="px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-gray-600 hover:bg-sky-50 hover:border-sky-200 hover:text-sky-700 transition-colors"
              >
                {feature}
              </Link>
            ))}
          </div>
        </div>

        {/* 施設一覧 */}
        {facilities.length > 0 ? (
          <section className="mb-10">
            <div className="grid sm:grid-cols-2 gap-6">
              {facilities.map((f) => (
                <FacilityCard key={f.id} facility={f} />
              ))}
            </div>
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              baseUrl={`/${prefectureSlug}/${typeSlug}`}
            />
          </section>
        ) : (
          <div className="text-center py-16 bg-white rounded-2xl mb-10">
            <p className="text-gray-500 text-sm">
              {prefName}の{typeName}は現在掲載されていません。
            </p>
            <Link href={`/${prefectureSlug}`} className="text-sky-600 text-sm mt-2 inline-block hover:underline">
              {prefName}の他の施設を見る
            </Link>
          </div>
        )}

        {/* エリア固有テキスト + FAQ */}
        <section className="mb-10 bg-white rounded-2xl p-6 sm:p-8">
          <h2 className="text-lg font-bold text-gray-900 mb-3">
            {seoContent?.h2_title || `${prefName}の${typeName}をお探しの方へ`}
          </h2>
          <p className="text-sm text-gray-600 leading-relaxed">
            {seoContent?.body_text || `${prefName}で${typeName}をお探しなら CareLink。口コミ・メニュー・写真で比較して、あなたにぴったりの${typeName}を見つけましょう。24時間ネット予約OK、掲載・利用すべて無料です。`}
          </p>
          {seoContent && seoContent.faq_items.length > 0 && (
            <div className="mt-6 space-y-4">
              <h3 className="text-sm font-bold text-gray-800">よくある質問</h3>
              {seoContent.faq_items.map((faq, i) => (
                <div key={i} className="border-b border-gray-100 pb-3">
                  <p className="text-sm font-medium text-gray-800">Q. {faq.question}</p>
                  <p className="text-sm text-gray-600 mt-1">A. {faq.answer}</p>
                </div>
              ))}
            </div>
          )}
        </section>
        {seoContent && seoContent.faq_items.length > 0 && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'FAQPage',
                mainEntity: seoContent.faq_items.map((faq) => ({
                  '@type': 'Question',
                  name: faq.question,
                  acceptedAnswer: { '@type': 'Answer', text: faq.answer },
                })),
              }),
            }}
          />
        )}

        {/* 関連リンク */}
        <RelatedLinks
          currentPrefectureSlug={prefectureSlug}
          currentTypeSlug={typeSlug}
          regionGroup={regionGroup}
        />
      </div>
    </div>
  );
}
