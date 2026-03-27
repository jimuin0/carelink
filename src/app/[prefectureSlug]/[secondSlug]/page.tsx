import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  allPrefectureSlugs,
  allBusinessTypeSlugs,
  getPrefectureName,
  getBusinessTypeName,
  isValidBusinessTypeSlug,
} from '@/lib/seo-constants';
import { regionGroups, facilityFeatures } from '@/lib/constants';
import { searchFacilities } from '@/lib/facilities';
import { getAreaSeoContent } from '@/lib/area-seo';
import { isValidCitySlug, getCityName, getCitiesForPrefecture, getAllCitySlugs } from '@/data/city-slugs';
import Breadcrumb from '@/components/Breadcrumb';
import FacilityCard from '@/components/search/FacilityCard';
import Pagination from '@/components/search/Pagination';
import RelatedLinks from '@/components/seo/RelatedLinks';
import SafeHtmlContent from '@/components/seo/SafeHtmlContent';

export const revalidate = 3600;
export const dynamicParams = true;

interface Props {
  params: Promise<{ prefectureSlug: string; secondSlug: string }>;
  searchParams: Promise<{ page?: string }>;
}

export function generateStaticParams() {
  const params: { prefectureSlug: string; secondSlug: string }[] = [];

  // 業種ページ: 47 × 8 = 376
  for (const ps of allPrefectureSlugs) {
    for (const ts of allBusinessTypeSlugs) {
      params.push({ prefectureSlug: ps, secondSlug: ts });
    }
  }

  // 市区町村ページ: 主要都府県のみ静的生成
  const majorPrefectures = ['tokyo', 'osaka', 'kanagawa', 'aichi', 'fukuoka', 'saitama', 'chiba', 'hyogo', 'kyoto', 'hokkaido'];
  const allCities = getAllCitySlugs();
  for (const c of allCities.filter((c) => majorPrefectures.includes(c.prefectureSlug))) {
    params.push({ prefectureSlug: c.prefectureSlug, secondSlug: c.citySlug });
  }

  return params;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { prefectureSlug, secondSlug } = await params;
  const prefName = getPrefectureName(prefectureSlug);
  if (!prefName) return {};

  // 業種ページ
  if (isValidBusinessTypeSlug(secondSlug)) {
    const typeName = getBusinessTypeName(secondSlug)!;
    const title = `${prefName}の${typeName}`;
    const description = `${prefName}の${typeName}を口コミ・メニュー・写真で比較。ネット予約24時間OK。CareLink で${prefName}の${typeName}を探そう。`;
    return {
      title,
      description,
      openGraph: { title: `${title} | CareLink`, description },
      alternates: { canonical: `/${prefectureSlug}/${secondSlug}` },
    };
  }

  // 市区町村ページ
  const cityName = getCityName(prefectureSlug, secondSlug);
  if (cityName) {
    const title = `${prefName}${cityName}のサロン・クリニック一覧`;
    const description = `${prefName}${cityName}の美容サロン・鍼灸院・整骨院を口コミ・メニュー・写真で比較。ネット予約24時間OK。`;
    return {
      title,
      description,
      openGraph: { title: `${title} | CareLink`, description },
      alternates: { canonical: `/${prefectureSlug}/${secondSlug}` },
    };
  }

  return {};
}

export default async function SecondSlugPage({ params, searchParams }: Props) {
  const { prefectureSlug, secondSlug } = await params;
  const prefName = getPrefectureName(prefectureSlug);
  if (!prefName) notFound();

  // ── 1. 業種ページ ──
  if (isValidBusinessTypeSlug(secondSlug)) {
    return <TypePage prefectureSlug={prefectureSlug} prefName={prefName} typeSlug={secondSlug} searchParams={searchParams} />;
  }

  // ── 2. 市区町村ページ ──
  if (isValidCitySlug(prefectureSlug, secondSlug)) {
    const cityName = getCityName(prefectureSlug, secondSlug)!;
    return <CityPage prefectureSlug={prefectureSlug} prefName={prefName} citySlug={secondSlug} cityName={cityName} searchParams={searchParams} />;
  }

  notFound();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 業種ページ
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function TypePage({ prefectureSlug, prefName, typeSlug, searchParams }: {
  prefectureSlug: string; prefName: string; typeSlug: string; searchParams: Promise<{ page?: string }>;
}) {
  const typeName = getBusinessTypeName(typeSlug)!;
  const { page: pageStr } = await searchParams;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://carelink-ruddy-psi.vercel.app';
  const page = Math.max(1, parseInt(pageStr || '1', 10) || 1);

  const [{ facilities, total, perPage }, seoContent] = await Promise.all([
    searchFacilities({ prefecture: prefName, type: typeName, sort: 'rating', page }),
    getAreaSeoContent(prefectureSlug, null, typeSlug),
  ]);
  const totalPages = Math.ceil(total / perPage);
  const regionGroup = regionGroups.find((r) => r.prefectures.includes(prefName));

  const itemListJsonLd = {
    '@context': 'https://schema.org', '@type': 'ItemList',
    name: `${prefName}の${typeName}`, numberOfItems: total,
    itemListElement: facilities.map((f, i) => ({
      '@type': 'ListItem', position: (page - 1) * perPage + i + 1, url: `${baseUrl}/facility/${f.slug}`, name: f.name,
    })),
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') }} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Breadcrumb items={[{ label: 'トップ', href: '/' }, { label: prefName, href: `/${prefectureSlug}` }, { label: typeName }]} />
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">{prefName}の{typeName}</h1>
        <p className="text-sm text-gray-500 mb-8">{total}件の施設が見つかりました</p>

        <div className="mb-8">
          <h2 className="text-sm font-bold text-gray-800 mb-3 pl-3 border-l-[3px] border-sky-500">こだわり条件で絞り込む</h2>
          <div className="flex flex-wrap gap-2">
            {facilityFeatures.map((feature) => (
              <Link key={feature} href={`/search?type=${encodeURIComponent(typeName)}&area=${encodeURIComponent(prefName)}&keyword=${encodeURIComponent(feature)}`}
                className="px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-gray-600 hover:bg-sky-50 hover:border-sky-200 hover:text-sky-700 transition-colors">
                {feature}
              </Link>
            ))}
          </div>
        </div>

        {facilities.length > 0 ? (
          <section className="mb-10">
            <div className="grid sm:grid-cols-2 gap-6">
              {facilities.map((f) => (<FacilityCard key={f.id} facility={f} />))}
            </div>
            <Pagination currentPage={page} totalPages={totalPages} baseUrl={`/${prefectureSlug}/${typeSlug}`} />
          </section>
        ) : (
          <div className="text-center py-16 bg-white rounded-2xl mb-10">
            <p className="text-gray-500 text-sm">{prefName}の{typeName}は現在掲載されていません。</p>
            <Link href={`/${prefectureSlug}`} className="text-sky-600 text-sm mt-2 inline-block hover:underline">{prefName}の他の施設を見る</Link>
          </div>
        )}

        <SeoTextSection seoContent={seoContent} fallbackTitle={`${prefName}の${typeName}をお探しの方へ`} fallbackBody={`${prefName}で${typeName}をお探しなら CareLink。口コミ・メニュー・写真で比較して、あなたにぴったりの${typeName}を見つけましょう。24時間ネット予約OK、掲載・利用すべて無料です。`} />
        <RelatedLinks currentPrefectureSlug={prefectureSlug} currentTypeSlug={typeSlug} regionGroup={regionGroup} />
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 市区町村ページ
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function CityPage({ prefectureSlug, prefName, citySlug, cityName, searchParams }: {
  prefectureSlug: string; prefName: string; citySlug: string; cityName: string; searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageStr } = await searchParams;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://carelink-ruddy-psi.vercel.app';
  const page = Math.max(1, parseInt(pageStr || '1', 10) || 1);

  const [{ facilities, total, perPage }, seoContent] = await Promise.all([
    searchFacilities({ prefecture: prefName, city: cityName, sort: 'rating', page }),
    getAreaSeoContent(prefectureSlug, citySlug),
  ]);
  const totalPages = Math.ceil(total / perPage);
  const regionGroup = regionGroups.find((r) => r.prefectures.includes(prefName));
  const siblingCities = getCitiesForPrefecture(prefectureSlug).filter((c) => c.slug !== citySlug);

  const itemListJsonLd = {
    '@context': 'https://schema.org', '@type': 'ItemList',
    name: `${cityName}のサロン・クリニック`, numberOfItems: total,
    itemListElement: facilities.map((f, i) => ({
      '@type': 'ListItem', position: (page - 1) * perPage + i + 1, url: `${baseUrl}/facility/${f.slug}`, name: f.name,
    })),
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') }} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Breadcrumb items={[{ label: 'トップ', href: '/' }, { label: prefName, href: `/${prefectureSlug}` }, { label: cityName }]} />
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">{cityName}のサロン・クリニック</h1>
        <p className="text-sm text-gray-500 mb-8">{total}件の施設が見つかりました</p>

        {/* 業種ナビ */}
        <section className="mb-10">
          <h2 className="text-sm font-bold text-gray-800 mb-4 pl-3 border-l-[3px] border-sky-500">{cityName}の業種から探す</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {allBusinessTypeSlugs.map((ts) => (
              <Link key={ts} href={`/${prefectureSlug}/${citySlug}/${ts}`}
                className="bg-white rounded-xl p-4 text-center hover:shadow-md transition-shadow border border-gray-100">
                <span className="text-sm font-medium text-gray-700">{getBusinessTypeName(ts)}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* 施設一覧 */}
        {facilities.length > 0 ? (
          <section className="mb-10">
            <div className="grid sm:grid-cols-2 gap-6">
              {facilities.map((f) => (<FacilityCard key={f.id} facility={f} />))}
            </div>
            <Pagination currentPage={page} totalPages={totalPages} baseUrl={`/${prefectureSlug}/${citySlug}`} />
          </section>
        ) : (
          <div className="text-center py-16 bg-white rounded-2xl mb-10">
            <p className="text-gray-500 text-sm">{cityName}の施設は現在掲載されていません。</p>
            <Link href={`/${prefectureSlug}`} className="text-sky-600 text-sm mt-2 inline-block hover:underline">{prefName}の施設を見る</Link>
          </div>
        )}

        <SeoTextSection seoContent={seoContent} fallbackTitle={`${cityName}でサロン・クリニックをお探しの方へ`} fallbackBody={`${prefName}${cityName}の美容サロン・鍼灸院・整骨院をお探しなら CareLink。口コミ・メニュー・写真で比較して、あなたにぴったりの施設を見つけましょう。24時間ネット予約OK、掲載・利用すべて無料です。`} />

        {/* 同県の他市区町村リンク */}
        {siblingCities.length > 0 && (
          <section className="bg-white rounded-2xl p-6 sm:p-8 mb-6">
            <h2 className="text-sm font-bold text-gray-800 mb-3 pl-3 border-l-[3px] border-sky-500">{prefName}の他のエリア</h2>
            <div className="flex flex-wrap gap-2">
              {siblingCities.map((c) => (
                <Link key={c.slug} href={`/${prefectureSlug}/${c.slug}`}
                  className="px-3.5 py-1.5 bg-sky-50 border border-sky-100 rounded-full text-xs text-sky-700 hover:bg-sky-100 transition-colors">
                  {c.name}
                </Link>
              ))}
            </div>
          </section>
        )}
        <RelatedLinks currentPrefectureSlug={prefectureSlug} currentCitySlug={citySlug} regionGroup={regionGroup} />
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 共通: SEOテキスト + FAQ
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function SeoTextSection({ seoContent, fallbackTitle, fallbackBody }: {
  seoContent: import('@/lib/area-seo').AreaSeoContent | null; fallbackTitle: string; fallbackBody: string;
}) {
  return (
    <>
      <section className="mb-10 bg-white rounded-2xl p-6 sm:p-8">
        <h2 className="text-lg font-bold text-gray-900 mb-3">{seoContent?.h2_title || fallbackTitle}</h2>
        <SafeHtmlContent
          html={seoContent?.body_text || fallbackBody}
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
        <script type="application/ld+json" dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org', '@type': 'FAQPage',
            mainEntity: seoContent.faq_items.map((faq) => ({
              '@type': 'Question', name: faq.question,
              acceptedAnswer: { '@type': 'Answer', text: faq.answer },
            })),
          }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'),
        }} />
      )}
    </>
  );
}
