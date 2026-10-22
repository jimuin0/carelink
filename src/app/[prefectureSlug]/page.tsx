import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  allBusinessTypeSlugs,
  businessTypeSlugs,
  getPrefectureName,
} from '@/lib/seo-constants';
import { regionGroups, SITE_URL } from '@/lib/constants';
import { safeJsonLd } from '@/lib/json-ld';
import { getCitiesForPrefecture } from '@/data/city-slugs';
import SafeHtmlContent from '@/components/seo/SafeHtmlContent';
import { countAreaListing, loadAreaListingPage } from '@/lib/area-listing';
import { getAreaSeoContent } from '@/lib/area-seo';
import { getPrefectureSeo } from '@/data/prefecture-seo';
import Breadcrumb from '@/components/Breadcrumb';
import FacilityCard from '@/components/search/FacilityCard';
import RelatedLinks from '@/components/seo/RelatedLinks';
import { businessTypeLabel } from '@/lib/business-type-label';

export const revalidate = 3600;
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ prefectureSlug: string }>;
}

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { prefectureSlug } = await params;
  const name = getPrefectureName(prefectureSlug);
  if (!name) return {};

  const title = `${name}のサロン・クリニック一覧`;
  const description = `${name}の美容サロン・鍼灸院・整骨院・介護施設を口コミ・メニュー・写真で比較。ネット予約も24時間OK。CareLink で${name}のサロン・クリニックを探そう。`;

  // 【2026年7月31日・階層間の不整合を是正】掲載0件のページを検索結果に載せない規則は
  // 子（都道府県×業種・市区町村・市区町村×業種）にはあったが、親であるこのページだけ
  // 抜けていた。本番実測では 46 都道府県が 0 件のまま index 可能だった。
  // follow は残す（0件でも回遊先リンクは辿らせる）。掲載が増えれば自動で index に戻る。
  // 件数は本文と同じ検索の読み取りから取る（src/lib/area-listing.ts）。数えられなかったとき（DB の一時障害）は
  // 例外にし、「件数不明＝index 可」とも扱わない。metadata だけ別の問い合わせにすると、それだけが落ちたとき
  // 本文が 200 で返り title・robots が欠ける（2026年10月22日 是正）。
  const count = await countAreaListing(name, undefined, undefined);

  return {
    title,
    description,
    openGraph: {
      title: `${title} | CareLink`,
      description,
      images: [{ url: `${SITE_URL}/api/og?title=${encodeURIComponent(title)}` }],
    },
    alternates: { canonical: `/${prefectureSlug}` },
    ...(count === 0 ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function PrefecturePage({ params }: Props) {
  const { prefectureSlug } = await params;
  const prefName = getPrefectureName(prefectureSlug);
  if (!prefName) notFound();

  // 読めなかった検索は「0件・掲載なし」として 200 で返さず、例外にして error.tsx の一時障害表示にする
  // （/search と同じ扱い・loadAreaListingPage が例外にする・2026年10月22日 是正）。
  const [{ facilities, total }, seoContent] = await Promise.all([
    loadAreaListingPage(prefName, undefined, undefined, 1),
    getAreaSeoContent(prefectureSlug),
  ]);

  // ハードコード固有データ（DBに詳細なseoContentがない場合のリッチフォールバック）
  const prefSeo = getPrefectureSeo(prefectureSlug);
  // FAQはハードコード優先（DBはジェネリックseed済みのため）
  const effectiveFaqs = prefSeo?.faqs && prefSeo.faqs.length > 0
    ? prefSeo.faqs
    : (seoContent?.faq_items ?? []);

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
      url: `${SITE_URL}/facility/${f.slug}`,
      name: f.name,
    })),
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(itemListJsonLd) }} />

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
              const typeName = businessTypeLabel(businessTypeSlugs[typeSlug]);
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
                  className="inline-flex items-center gap-2 text-sm text-sky-700 hover:text-sky-700 font-medium"
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
          {prefSeo ? (
            <div className="text-sm text-gray-600 leading-relaxed space-y-3">
              <p>{prefSeo.intro}</p>
              {prefSeo.highlights.length > 0 && (
                <ul className="list-disc pl-5 space-y-1 text-gray-700">
                  {prefSeo.highlights.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : seoContent?.body_text ? (
            <SafeHtmlContent
              html={seoContent.body_text}
              className="text-sm text-gray-600 leading-relaxed [&>p]:mb-3 [&>p:last-child]:mb-0"
            />
          ) : (
            <p className="text-sm text-gray-600 leading-relaxed">
              {prefName}の美容サロン・鍼灸院・整骨院・介護施設をお探しなら CareLink。
            </p>
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
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: safeJsonLd({
                '@context': 'https://schema.org',
                '@type': 'FAQPage',
                mainEntity: effectiveFaqs.map((faq) => ({
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
          regionGroup={regionGroup}
        />
      </div>
    </div>
  );
}
