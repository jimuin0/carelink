import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  allBusinessTypeSlugs,
  businessTypeSlugs,
  getBusinessTypeName,
  isValidBusinessTypeSlug,
  prefectureSlugs,
} from '@/lib/seo-constants';
import { SITE_URL } from '@/lib/constants';
import { searchFacilities } from '@/lib/facilities';
import { getBusinessTypeContext } from '@/lib/seo-snippets';
import Breadcrumb from '@/components/Breadcrumb';
import FacilityCard from '@/components/search/FacilityCard';

export const revalidate = 3600;

interface Props {
  params: Promise<{ typeSlug: string }>;
}

export function generateStaticParams() {
  return allBusinessTypeSlugs.map((slug) => ({ typeSlug: slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { typeSlug } = await params;
  const typeName = getBusinessTypeName(typeSlug);
  if (!typeName) return {};
  const ctx = getBusinessTypeContext(typeSlug);
  const description = ctx
    ? `${typeName}（${ctx.keyword}）を全国から検索。${ctx.description}を口コミ・料金・写真で比較し、24時間ネット予約できます。`
    : `${typeName}を全国から検索・比較・予約。CareLinkで自分にぴったりの${typeName}を見つけましょう。`;
  return {
    title: `${typeName}を全国から探す｜口コミ・料金で比較 | CareLink`,
    description,
    alternates: { canonical: `/type/${typeSlug}` },
  };
}

export default async function BusinessTypePage({ params }: Props) {
  const { typeSlug } = await params;
  if (!isValidBusinessTypeSlug(typeSlug)) notFound();
  const typeName = getBusinessTypeName(typeSlug)!;
  const ctx = getBusinessTypeContext(typeSlug);

  const { facilities, total } = await searchFacilities({ type: typeName, sort: 'rating' });

  // ItemList JSON-LD
  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `全国の${typeName}`,
    numberOfItems: total,
    itemListElement: facilities.slice(0, 10).map((f, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_URL}/facility/${f.slug}`,
      name: f.name,
    })),
  };

  // FAQPage JSON-LD
  const faqJsonLd = ctx && ctx.faqs.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: ctx.faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  } : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') }} />
      {faqJsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') }} />
      )}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Breadcrumb items={[{ label: 'トップ', href: '/' }, { label: typeName }]} />

        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
          全国の{typeName}
        </h1>
        <p className="text-sm text-gray-500 mb-8">{total}件の施設を掲載中</p>

        {/* SEO本文 */}
        {ctx && (
          <section className="mb-10 bg-white rounded-2xl p-6 sm:p-8">
            <h2 className="text-lg font-bold text-gray-900 mb-3">{typeName}とは？</h2>
            <p className="text-sm text-gray-700 leading-relaxed mb-4">{ctx.description}。CareLinkでは全国の{typeName}を口コミ・料金・写真で比較し、24時間ネット予約が可能です。</p>
            <h3 className="text-sm font-bold text-gray-800 mb-2 mt-4">{typeName}選びのポイント</h3>
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">
              {ctx.searchPoints.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          </section>
        )}

        {/* 都道府県ナビ */}
        <section className="mb-10">
          <h2 className="text-sm font-bold text-gray-800 mb-4 pl-3 border-l-[3px] border-sky-500">
            都道府県から{typeName}を探す
          </h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(prefectureSlugs).map(([slug, name]) => (
              <Link
                key={slug}
                href={`/${slug}/${typeSlug}`}
                className="px-3.5 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-gray-700 hover:bg-sky-50 hover:border-sky-200 hover:text-sky-700 transition-colors"
              >
                {name}の{typeName}
              </Link>
            ))}
          </div>
        </section>

        {/* 人気施設一覧 */}
        {facilities.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm font-bold text-gray-800 mb-4 pl-3 border-l-[3px] border-sky-500">
              人気の{typeName}
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {facilities.slice(0, 12).map((f) => (
                <FacilityCard key={f.id} facility={f} />
              ))}
            </div>
          </section>
        )}

        {/* FAQ */}
        {ctx && ctx.faqs.length > 0 && (
          <section className="mb-10 bg-white rounded-2xl p-6 sm:p-8">
            <h2 className="text-lg font-bold text-gray-900 mb-4">{typeName}についてよくある質問</h2>
            <div className="space-y-4">
              {ctx.faqs.map((faq, i) => (
                <div key={i} className="border-b border-gray-100 pb-3 last:border-0">
                  <p className="text-sm font-medium text-gray-800">Q. {faq.q}</p>
                  <p className="text-sm text-gray-600 mt-1">A. {faq.a}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 他業種ナビ */}
        <section className="bg-white rounded-2xl p-6 sm:p-8">
          <h2 className="text-sm font-bold text-gray-800 mb-3 pl-3 border-l-[3px] border-sky-500">
            他の業種から探す
          </h2>
          <div className="flex flex-wrap gap-2">
            {allBusinessTypeSlugs.filter((s) => s !== typeSlug).map((s) => (
              <Link
                key={s}
                href={`/type/${s}`}
                className="px-3.5 py-1.5 bg-sky-50 border border-sky-100 rounded-full text-xs text-sky-700 hover:bg-sky-100 transition-colors"
              >
                {businessTypeSlugs[s]}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
