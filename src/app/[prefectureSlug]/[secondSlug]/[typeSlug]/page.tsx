import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  allBusinessTypeSlugs,
  getPrefectureName,
  getBusinessTypeName,
  isValidBusinessTypeSlug,
} from '@/lib/seo-constants';
import { facilityFeatures, SITE_URL } from '@/lib/constants';
import { searchFacilities } from '@/lib/facilities';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import { getAreaSeoContent } from '@/lib/area-seo';
import { generateCityTypeContent } from '@/lib/seo-snippets';
import { isValidCitySlug, getCityName, getCitiesForPrefecture } from '@/data/city-slugs';
import Breadcrumb from '@/components/Breadcrumb';
import FacilityCard from '@/components/search/FacilityCard';
import Pagination from '@/components/search/Pagination';
import SafeHtmlContent from '@/components/seo/SafeHtmlContent';

export const revalidate = 3600;
export const dynamicParams = true;

interface Props {
  params: Promise<{ prefectureSlug: string; secondSlug: string; typeSlug: string }>;
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { prefectureSlug, secondSlug, typeSlug } = await params;
  const prefName = getPrefectureName(prefectureSlug);
  const cityName = getCityName(prefectureSlug, secondSlug);
  const typeName = getBusinessTypeName(typeSlug);
  if (!prefName || !cityName || !typeName) return {};

  const title = `${cityName}の${typeName}`;
  const description = `${prefName}${cityName}の${typeName}を口コミ・メニュー・写真で比較。ネット予約24時間OK。`;
  const supabase = createServerSupabaseClient();
  const { count } = await supabase
    .from('facility_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .eq('prefecture', prefName)
    .eq('city', cityName)
    .eq('business_type', typeName);
  return {
    title,
    description,
    openGraph: { title: `${title} | CareLink`, description },
    alternates: { canonical: `/${prefectureSlug}/${secondSlug}/${typeSlug}` },
    ...(count === 0 ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function CityTypePage({ params, searchParams }: Props) {
  const { prefectureSlug, secondSlug, typeSlug } = await params;
  const prefName = getPrefectureName(prefectureSlug);
  const cityName = getCityName(prefectureSlug, secondSlug);
  const typeName = getBusinessTypeName(typeSlug);

  // secondSlugが市区町村でなければ404（業種/業種の二重パスは無効）
  if (!prefName || !isValidCitySlug(prefectureSlug, secondSlug) || !cityName || !isValidBusinessTypeSlug(typeSlug) || !typeName) {
    notFound();
  }

  const { page: pageStr } = await searchParams;
  const page = Math.max(1, parseInt(pageStr || '1', 10) || 1);

  const [{ facilities, total, perPage }, seoContent] = await Promise.all([
    searchFacilities({ prefecture: prefName, city: cityName, type: typeName, sort: 'rating', page }),
    getAreaSeoContent(prefectureSlug, secondSlug, typeSlug),
  ]);
  const totalPages = Math.ceil(total / perPage);
  const siblingCities = getCitiesForPrefecture(prefectureSlug).filter((c) => c.slug !== secondSlug).slice(0, 12);

  const itemListJsonLd = {
    '@context': 'https://schema.org', '@type': 'ItemList',
    name: `${cityName}の${typeName}`, numberOfItems: total,
    itemListElement: facilities.map((f, i) => ({
      '@type': 'ListItem', position: (page - 1) * perPage + i + 1, url: `${SITE_URL}/facility/${f.slug}`, name: f.name,
    })),
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') }} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Breadcrumb items={[
          { label: 'トップ', href: '/' },
          { label: prefName, href: `/${prefectureSlug}` },
          { label: cityName, href: `/${prefectureSlug}/${secondSlug}` },
          { label: typeName },
        ]} />

        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">{cityName}の{typeName}</h1>
        <p className="text-sm text-gray-500 mb-8">{total}件の施設が見つかりました</p>

        {/* こだわり条件 */}
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

        {/* 施設一覧 */}
        {facilities.length > 0 ? (
          <section className="mb-10">
            <div className="grid sm:grid-cols-2 gap-6">
              {facilities.map((f) => (<FacilityCard key={f.id} facility={f} />))}
            </div>
            <Pagination currentPage={page} totalPages={totalPages} baseUrl={`/${prefectureSlug}/${secondSlug}/${typeSlug}`} />
          </section>
        ) : (
          <div className="text-center py-16 bg-white rounded-2xl mb-10">
            <p className="text-gray-500 text-sm">{cityName}の{typeName}は現在掲載されていません。</p>
            <Link href={`/${prefectureSlug}/${secondSlug}`} className="text-sky-600 text-sm mt-2 inline-block hover:underline">{cityName}の他の施設を見る</Link>
          </div>
        )}

        {/* SEOテキスト（生成器ベース、DBはフォールバック） */}
        {(() => {
          const generated = generateCityTypeContent(prefectureSlug, cityName, typeSlug);
          const effectiveFaqs = generated?.faqs && generated.faqs.length > 0
            ? generated.faqs
            : (seoContent?.faq_items ?? []);
          return (
            <>
              <section className="mb-10 bg-white rounded-2xl p-6 sm:p-8">
                <h2 className="text-lg font-bold text-gray-900 mb-3">
                  {generated?.h2 || seoContent?.h2_title || `${cityName}の${typeName}をお探しの方へ`}
                </h2>
                {generated ? (
                  <div className="text-sm text-gray-600 leading-relaxed space-y-3">
                    <p>{generated.intro}</p>
                    {generated.highlights.length > 0 && (
                      <ul className="list-disc pl-5 space-y-1 text-gray-700">
                        {generated.highlights.map((h, i) => (
                          <li key={i}>{h}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <SafeHtmlContent
                    html={seoContent?.body_text || `<p>${prefName}${cityName}で${typeName}をお探しなら CareLink。</p>`}
                    className="text-sm text-gray-600 leading-relaxed [&>p]:mb-3 [&>p:last-child]:mb-0"
                  />
                )}
                {effectiveFaqs.length > 0 && (
                  <div className="mt-6 space-y-4">
                    <h3 className="text-sm font-bold text-gray-800">よくある質問</h3>
                    {effectiveFaqs.map((faq, i) => (
                      <div key={i} className="border-b border-gray-100 pb-3">
                        <p className="text-sm font-medium text-gray-800">Q. {faq.question}</p>
                        <p className="text-sm text-gray-600 mt-1">A. {faq.answer}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              {effectiveFaqs.length > 0 && (
                <script type="application/ld+json" dangerouslySetInnerHTML={{
                  __html: JSON.stringify({
                    '@context': 'https://schema.org', '@type': 'FAQPage',
                    mainEntity: effectiveFaqs.map((faq) => ({
                      '@type': 'Question', name: faq.question,
                      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
                    })),
                  }).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'),
                }} />
              )}
            </>
          );
        })()}

        {/* 同区の他業種 */}
        <section className="bg-white rounded-2xl p-6 sm:p-8 mb-6">
          <h2 className="text-sm font-bold text-gray-800 mb-3 pl-3 border-l-[3px] border-sky-500">{cityName}の他の業種</h2>
          <div className="flex flex-wrap gap-2">
            {allBusinessTypeSlugs.filter((ts) => ts !== typeSlug).map((ts) => (
              <Link key={ts} href={`/${prefectureSlug}/${secondSlug}/${ts}`}
                className="px-3.5 py-1.5 bg-sky-50 border border-sky-100 rounded-full text-xs text-sky-700 hover:bg-sky-100 transition-colors">
                {cityName}の{getBusinessTypeName(ts)}
              </Link>
            ))}
          </div>
        </section>

        {/* 同業種の他市区町村 */}
        {siblingCities.length > 0 && (
          <section className="bg-white rounded-2xl p-6 sm:p-8 mb-6">
            <h2 className="text-sm font-bold text-gray-800 mb-3 pl-3 border-l-[3px] border-sky-500">{prefName}の他のエリアの{typeName}</h2>
            <div className="flex flex-wrap gap-2">
              {siblingCities.map((c) => (
                <Link key={c.slug} href={`/${prefectureSlug}/${c.slug}/${typeSlug}`}
                  className="px-3.5 py-1.5 bg-gray-50 border border-gray-200 rounded-full text-xs text-gray-600 hover:bg-gray-100 transition-colors">
                  {c.name}
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
