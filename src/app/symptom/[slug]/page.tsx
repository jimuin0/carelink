import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import FacilityCard from '@/components/search/FacilityCard';
import { getSymptomSeo } from '@/data/symptom-seo';
import { SITE_URL } from '@/lib/constants';
import { safeJsonLd } from '@/lib/json-ld';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { data: symptom } = await supabase
    .from('symptoms')
    .select('name, category')
    .eq('slug', slug)
    .maybeSingle();

  if (!symptom) return { title: '症状が見つかりません' };

  const seo = getSymptomSeo(slug);
  const description = seo
    ? `${symptom.name}の原因・治療法・対応施設を解説。${seo.intro.slice(0, 80)}`
    : `${symptom.name}でお悩みの方へ。${symptom.name}に対応できる鍼灸院・整骨院・クリニックを検索・予約。`;

  return {
    title: `${symptom.name}に対応できるサロン・クリニック｜原因・治療法ガイド`,
    description,
    alternates: { canonical: `/symptom/${slug}` },
  };
}

export default async function SymptomPage({ params }: Props) {
  const { slug } = await params;
  const { data: symptom } = await supabase
    .from('symptoms')
    .select('id, name, slug, category')
    .eq('slug', slug)
    .maybeSingle();

  if (!symptom) notFound();

  const seo = getSymptomSeo(slug);

  // この症状に対応する施設を取得
  const { data: facilitySymptoms } = await supabase
    .from('facility_symptoms')
    .select('facility_id, description')
    .eq('symptom_id', symptom.id);

  const facilityIds = (facilitySymptoms || []).map(fs => fs.facility_id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let facilities: any[] = [];
  if (facilityIds.length > 0) {
    const { data } = await supabase
      .from('facility_profiles')
      .select('id, name, slug, business_type, prefecture, city, main_photo_url, rating_avg, rating_count, catch_copy')
      .eq('status', 'published')
      .in('id', facilityIds);
    facilities = data || [];
  }

  // 同カテゴリの他の症状
  const { data: relatedSymptoms } = await supabase
    .from('symptoms')
    .select('name, slug')
    .eq('category', symptom.category)
    .neq('id', symptom.id)
    .order('sort_order')
    .limit(10);

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

        <h1 className="text-xl sm:text-2xl font-bold text-gray-800 mb-2">
          {symptom.name}に対応できるサロン・クリニック
        </h1>
        <p className="text-sm text-gray-500 mb-8">
          {symptom.name}でお悩みの方に。原因・治療法・対応施設を口コミ・料金で比較できます。
        </p>

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
          <div className="text-center py-12 bg-gray-50 rounded-xl mb-10">
            <p className="text-gray-500 text-sm">現在、{symptom.name}に対応可能な施設は登録されていません。</p>
            <Link href="/search" className="text-sky-600 text-sm mt-2 inline-block hover:underline">
              すべての施設を検索する →
            </Link>
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
