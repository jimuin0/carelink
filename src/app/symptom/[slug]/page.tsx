import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import FacilityCard from '@/components/search/FacilityCard';
import { getSymptomSeo } from '@/data/symptom-seo';
import { SITE_URL } from '@/lib/constants';
import { safeJsonLd } from '@/lib/json-ld';
import { readPageResult } from '@/lib/page-read-verification';
import { SYMPTOM_FALLBACK_HREF, SYMPTOM_FALLBACK_TYPE_NAME } from '@/lib/symptom-fallback';

// 遅延初期化: モジュールスコープで createClient を呼ぶとビルド時の
// page data 収集フェーズで env 未設定環境（Vercel preview 等）が
// "supabaseUrl is required" で落ちるため、関数として定義し利用時に生成する。
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// 【2026年7月8日 恒久根治】revalidate/dynamic の明示指定が無く、generateStaticParams も無いため
// Next.js のデフォルト挙動（動的APIを使わなければフルstatic＝実質無期限キャッシュ）に委ねられて
// おり、症状データ(symptoms/facility_symptoms)の更新がビルド後に反映されない懸念があった。
// 同種のDB駆動動的ページ([prefectureSlug]/type/[typeSlug]/feature/[slug]/blog/[slug]/
// ranking/[area]/search/area/[slug])は全て revalidate=3600 で統一しているため、これに合わせる。
export const revalidate = 3600;

interface Props {
  params: Promise<{ slug: string }>;
}

/**
 * 症状と、それに対応する公開中の施設。metadata と本文の両方が同じ結果を使う
 * （同じリクエスト内では cache で 1 回にまとまる）。
 *
 * metadata が施設の件数を知る必要があるのは、施設 0 件のページを noindex にするため
 * （2026年10月22日・神原さん決定「施設が載るまで検索に出さない」）。対応症状を登録する手段が
 * まだ無く本番は全症状 0 件で、30 本とも空のまま検索エンジンに出ていた。
 */
const loadSymptomListing = cache(async (slug: string) => {
  const supabase = getSupabase();
  const { data: symptom } = await readPageResult(() => supabase
    .from('symptoms')
    .select('id, name, slug, category')
    .eq('slug', slug)
    .maybeSingle(), 'symptom-page');
  if (!symptom) return null;

  // この症状に対応する施設を取得
  const { data: facilitySymptoms } = await readPageResult(() => supabase
    .from('facility_symptoms')
    .select('facility_id, description')
    .eq('symptom_id', symptom.id), 'symptom-facility-links');

  const facilityIds = (facilitySymptoms || []).map(fs => fs.facility_id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let facilities: any[] = [];
  if (facilityIds.length > 0) {
    const { data } = await readPageResult(() => supabase
      .from('facility_profiles')
      .select('id, name, slug, business_type, prefecture, city, main_photo_url, rating_avg, rating_count, catch_copy')
      .eq('status', 'published')
      .in('id', facilityIds), 'symptom-facilities');
    facilities = data || [];
  }
  return { symptom, facilities };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const listing = await loadSymptomListing(slug);

  if (!listing) return { title: '症状が見つかりません' };
  const { symptom, facilities } = listing;

  const seo = getSymptomSeo(slug);
  const description = seo
    ? `${symptom.name}の原因・治療法・対応施設を解説。${seo.intro.slice(0, 80)}`
    : `${symptom.name}でお悩みの方へ。${symptom.name}に対応できる鍼灸院・整骨院・クリニックを検索・予約。`;

  return {
    title: `${symptom.name}に対応できるサロン・クリニック｜原因・治療法ガイド`,
    description,
    alternates: { canonical: `/symptom/${slug}` },
    // 公開施設が 0 件のあいだは検索結果に出さない。follow は残す（関連症状・業種ページへの
    // リンクは辿らせ、施設が載れば自動で index に戻る）。sitemap も同じ条件で外している。
    ...(facilities.length === 0 ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function SymptomPage({ params }: Props) {
  const { slug } = await params;
  const listing = await loadSymptomListing(slug);

  if (!listing) notFound();
  const { symptom, facilities } = listing;

  const seo = getSymptomSeo(slug);
  const supabase = getSupabase();

  // 同カテゴリの他の症状
  const { data: relatedSymptoms } = await readPageResult(() => supabase
    .from('symptoms')
    .select('name, slug')
    .eq('category', symptom.category)
    .neq('id', symptom.id)
    .order('sort_order')
    .limit(10), 'symptom-related');

  // FAQPage JSON-LD
  const faqJsonLd = seo && seo.faqs.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: seo.faqs.map(f => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  } : null;

  // BreadcrumbList JSON-LD
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'CareLink', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: '症状から探す', item: `${SITE_URL}/symptom-checker` },
      { '@type': 'ListItem', position: 3, name: symptom.name, item: `${SITE_URL}/symptom/${slug}` },
    ],
  };

  return (
    <div className="min-h-screen bg-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbJsonLd) }} />
      {faqJsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(faqJsonLd) }} />
      )}
      <div className="max-w-[1040px] mx-auto px-4 sm:px-6 py-8">
        {/* パンくず */}
        <nav className="text-xs text-gray-500 mb-6">
          <Link href="/" className="hover:text-sky-600">CareLink</Link>
          <span className="mx-2">&gt;</span>
          <Link href="/symptom-checker" className="hover:text-sky-600">症状から探す</Link>
          <span className="mx-2">&gt;</span>
          <span className="text-gray-800">{symptom.name}</span>
        </nav>

        <h1 className="jp-balance text-xl sm:text-2xl font-bold text-gray-800 mb-2">
          {symptom.name}に対応できるサロン・クリニック
        </h1>
        <p className="text-sm text-gray-500 mb-4">
          {symptom.name}でお悩みの方に。原因・治療法・対応施設を口コミ・料金で比較できます。
        </p>

        {/* 【医療上の免責・必須】症状チェッカーと同じ扱い。疾患名（椎間板ヘルニア・顔面神経麻痺・不妊など）の
            ページで原因・治療の選択肢と施設を並べるため、診断ではないこと・受診勧奨を本文より前に明示する
            （医師法・医療広告ガイドライン・あはき法）。施設が 0 件のページも関連症状のリンクから辿られる。 */}
        <div className="mb-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3" role="note">
          <p className="text-xs text-amber-900 leading-relaxed">
            このページは、施設を探すための参考情報であり、医学的な診断ではありません。
            症状が続く場合、強い痛みや発熱をともなう場合、急に悪化した場合は、自己判断せず医療機関を受診してください。
            治療の効果や結果を保証するものではありません。
          </p>
        </div>

        {/* SEO本文 */}
        {seo && (
          <section className="mb-10 bg-sky-50/40 rounded-2xl p-6 sm:p-8 border border-sky-100">
            <h2 className="text-lg font-bold text-gray-900 mb-3">{symptom.name}とは？原因と対処法</h2>
            <p className="text-sm text-gray-700 leading-relaxed mb-4">{seo.intro}</p>

            <h3 className="text-sm font-bold text-gray-800 mb-2 mt-4">主な原因</h3>
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-4">
              {seo.causes.map((c, i) => <li key={i}>{c}</li>)}
            </ul>

            <h3 className="text-sm font-bold text-gray-800 mb-2 mt-4">主な治療選択肢</h3>
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-4">
              {seo.treatments.map((t, i) => <li key={i}>{t}</li>)}
            </ul>

            <div className="bg-white rounded-lg p-4 border border-sky-100">
              <p className="text-xs font-bold text-sky-700 mb-1">セルフケア</p>
              <p className="text-sm text-gray-700">{seo.selfCare}</p>
            </div>
          </section>
        )}

        {/* 施設一覧 */}
        <h2 className="text-base font-bold text-gray-900 mb-4 pl-3 border-l-[3px] border-sky-500">
          {symptom.name}に対応している施設
        </h2>
        {facilities.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
            {facilities.map((f) => (
              <FacilityCard key={f.id} facility={f} />
            ))}
          </div>
        ) : (
          /* 空のまま終わらせず、施設の一覧へ案内する（行き止まりにしない）。
             「この症状は鍼灸院・整骨院で扱うもの」とは書かない。症状にはアレルギー・不妊・胃腸の不調など
             整骨院（柔道整復）の対象外のものも含まれるため、一覧から「探すこともできる」とだけ案内する。 */
          <div className="text-center py-12 px-4 bg-gray-50 rounded-xl mb-10">
            <p className="text-gray-600 text-sm">現在、{symptom.name}に対応可能な施設は登録されていません。</p>
            <p className="text-gray-600 text-sm mt-1">
              {SYMPTOM_FALLBACK_TYPE_NAME}の一覧から探すこともできます。
            </p>
            <div className="mt-4 flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href={SYMPTOM_FALLBACK_HREF}
                className="px-5 py-2.5 bg-sky-700 text-white rounded-lg text-sm font-bold hover:bg-sky-800 transition-colors"
              >
                {SYMPTOM_FALLBACK_TYPE_NAME}の一覧を見る
              </Link>
              <Link
                href="/search"
                className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-50 transition-colors"
              >
                すべての施設を検索する
              </Link>
            </div>
          </div>
        )}

        {/* FAQ */}
        {seo && seo.faqs.length > 0 && (
          <section className="mb-10 bg-white rounded-2xl p-6 sm:p-8 border border-gray-100">
            <h2 className="text-lg font-bold text-gray-900 mb-4">{symptom.name}についてよくある質問</h2>
            <div className="space-y-4">
              {seo.faqs.map((faq, i) => (
                <div key={i} className="border-b border-gray-100 pb-3 last:border-0">
                  <p className="text-sm font-medium text-gray-800">Q. {faq.question}</p>
                  <p className="text-sm text-gray-600 mt-1">A. {faq.answer}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 関連症状 */}
        {relatedSymptoms && relatedSymptoms.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-bold text-gray-800 mb-3 pl-3 border-l-[3px] border-sky-500">
              {symptom.category}の他の症状
            </h2>
            <div className="flex flex-wrap gap-2">
              {relatedSymptoms.map((s) => (
                <Link
                  key={s.slug}
                  href={`/symptom/${s.slug}`}
                  className="px-3.5 py-1.5 bg-gray-50 border border-gray-200 rounded-full text-xs text-gray-600 hover:bg-sky-50 hover:border-sky-200 hover:text-sky-700 transition-colors"
                >
                  {s.name}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
