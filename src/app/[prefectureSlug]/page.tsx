import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  allPrefectureSlugs,
  allBusinessTypeSlugs,
  businessTypeSlugs,
  getPrefectureName,
} from '@/lib/seo-constants';
import { regionGroups } from '@/lib/constants';
import { getCitiesForPrefecture } from '@/data/city-slugs';
import SafeHtmlContent from '@/components/seo/SafeHtmlContent';
import { searchFacilities } from '@/lib/facilities';
import { getAreaSeoContent } from '@/lib/area-seo';
import Breadcrumb from '@/components/Breadcrumb';
import FacilityCard from '@/components/search/FacilityCard';
import RelatedLinks from '@/components/seo/RelatedLinks';

export const revalidate = 3600;

interface Props {
  params: Promise<{ prefectureSlug: string }>;
}

export function generateStaticParams() {
  return allPrefectureSlugs.map((slug) => ({ prefectureSlug: slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { prefectureSlug } = await params;
  const name = getPrefectureName(prefectureSlug);
  if (!name) return {};

  const title = `${name}のサロン・クリニック一覧`;
  const description = `${name}の美容サロン・鍼灸院・整骨院・介護施設を口コミ・メニュー・写真で比較。ネット予約も24時間OK。CareLink で${name}のサロン・クリニックを探そう。`;

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://carelink-ruddy-psi.vercel.app';
  return {
    title,
    description,
    openGraph: {
      title: `${title} | CareLink`,
      description,
      images: [{ url: `${baseUrl}/api/og?title=${encodeURIComponent(title)}` }],
    },
    alternates: { canonical: `/${prefectureSlug}` },
  };
}

export default async function PrefecturePage({ params }: Props) {
  const { prefectureSlug } = await params;
  const prefName = getPrefectureName(prefectureSlug);
  if (!prefName) notFound();

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://carelink-ruddy-psi.vercel.app';

  const [{ facilities, total }, seoContent] = await Promise.all([
    searchFacilities({ prefecture: prefName, sort: 'rating' }),
    getAreaSeoContent(prefectureSlug),
  ]);

  // 同じ地域グループの他県を取得
  const regionGroup = regionGroups.find((r) => r.prefectures.includes(prefName));

  // ItemList JSON-LD
  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${prefName}のサロン・クリニック`,
    numberOfItems: total,
    itemListElement: facilities.slice(0, 10).map((f, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${baseUrl}/facility/${f.slug}`,
      name: f.name,
    })),
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') }} />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Breadcrumb
          items={[
            { label: 'トップ', href: '/' },
            { label: prefName },
          ]}
        />

        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
          {prefName}のサロン・クリニック
        </h1>
        <p className="text-sm text-gray-500 mb-8">{total}件の施設が見つかりました</p>

        {/* 業種ナビ */}
        <section className="mb-10">
          <h2 className="text-sm font-bold text-gray-800 mb-4 pl-3 border-l-[3px] border-sky-500">
            業種から探す
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {allBusinessTypeSlugs.map((typeSlug) => {
              const typeName = businessTypeSlugs[typeSlug];
              return (
                <Link
                  key={typeSlug}
                  href={`/${prefectureSlug}/${typeSlug}`}
                  className="bg-white rounded-xl p-4 text-center hover:shadow-md transition-shadow border border-gray-100"
                >
                  <span className="text-sm font-medium text-gray-700">{typeName}</span>
                </Link>
              );
            })}
          </div>
        </section>

        {/* エリアから探す（市区町村ナビ） */}
        {(() => {
          const cities = getCitiesForPrefecture(prefectureSlug);
          if (cities.length === 0) return null;
          return (
            <section className="mb-10">
              <h2 className="text-sm font-bold text-gray-800 mb-4 pl-3 border-l-[3px] border-sky-500">
                {prefName}のエリアから探す
              </h2>
              <div className="flex flex-wrap gap-2">
                {cities.map((c) => (
                  <Link
                    key={c.slug}
                    href={`/${prefectureSlug}/${c.slug}`}
                    className="px-3.5 py-2 bg-white border border-gray-200 rounded-lg text-xs text-gray-700 hover:bg-sky-50 hover:border-sky-200 hover:text-sky-700 transition-colors"
                  >
                    {c.name}
                  </Link>
                ))}
              </div>
            </section>
          );
        })()}

        {/* 人気施設一覧 */}
        {facilities.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm font-bold text-gray-800 mb-4 pl-3 border-l-[3px] border-sky-500">
              {prefName}の人気施設
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {facilities.slice(0, 6).map((f) => (
                <FacilityCard key={f.id} facility={f} />
              ))}
            </div>
            {total > 6 && (
              <div className="text-center mt-6">
                <Link
                  href={`/search?area=${encodeURIComponent(prefName)}`}
                  className="inline-flex items-center gap-2 text-sm text-sky-600 hover:text-sky-700 font-medium"
                >
                  {prefName}の施設をすべて見る ({total}件)
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </Link>
              </div>
            )}
          </section>
        )}

        {/* エリア固有テキスト + FAQ */}
        <section className="mb-10 bg-white rounded-2xl p-6 sm:p-8">
          <h2 className="text-lg font-bold text-gray-900 mb-3">
            {seoContent?.h2_title || `${prefName}でサロン・クリニックをお探しの方へ`}
          </h2>
          <SafeHtmlContent
            html={seoContent?.body_text || `<p>${prefName}の美容サロン・鍼灸院・整骨院・介護施設をお探しなら CareLink。口コミ・メニュー・写真で比較して、あなたにぴったりの施設を見つけましょう。24時間ネット予約OK、掲載・利用すべて無料です。</p>`}
            className="text-sm text-gray-600 leading-relaxed [&>p]:mb-3 [&>p:last-child]:mb-0"
          />
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
              }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'),
            }}
          />
        )}

        {/* 関連リンク */}
        <RelatedLinks
          currentPrefectureSlug={prefectureSlug}
          regionGroup={regionGroup}
        />
      </div>
    </div>
  );
}
