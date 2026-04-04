import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import FacilityCard from '@/components/search/FacilityCard';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface Props {
  params: { slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { data: symptom } = await supabase
    .from('symptoms')
    .select('name, category')
    .eq('slug', params.slug)
    .maybeSingle();

  if (!symptom) return { title: '症状が見つかりません' };

  return {
    title: `${symptom.name}に対応できるサロン・クリニック`,
    description: `${symptom.name}でお悩みの方へ。${symptom.name}に対応できる鍼灸院・整骨院・クリニックを検索・予約。口コミ・料金で比較。`,
    alternates: { canonical: `/symptom/${params.slug}` },
  };
}

export default async function SymptomPage({ params }: Props) {
  const { data: symptom } = await supabase
    .from('symptoms')
    .select('id, name, slug, category')
    .eq('slug', params.slug)
    .maybeSingle();

  if (!symptom) notFound();

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

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-[1040px] mx-auto px-4 sm:px-6 py-8">
        {/* パンくず */}
        <nav className="text-xs text-gray-500 mb-6">
          <Link href="/" className="hover:text-sky-600">CareLink</Link>
          <span className="mx-2">&gt;</span>
          <span className="text-gray-800">{symptom.name}</span>
        </nav>

        <h1 className="text-xl sm:text-2xl font-bold text-gray-800 mb-2">
          {symptom.name}に対応できるサロン・クリニック
        </h1>
        <p className="text-sm text-gray-500 mb-8">
          {symptom.name}でお悩みの方に。対応可能な施設を口コミ・料金で比較できます。
        </p>

        {/* 施設一覧 */}
        {facilities.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
            {facilities.map((f) => (
              <FacilityCard key={f.id} facility={f} />
            ))}
          </div>
        ) : (
          <div className="text-center py-16 bg-gray-50 rounded-xl mb-10">
            <p className="text-gray-500 text-sm">現在、{symptom.name}に対応可能な施設は登録されていません。</p>
            <Link href="/search" className="text-sky-600 text-sm mt-2 inline-block hover:underline">
              すべての施設を検索する →
            </Link>
          </div>
        )}

        {/* 関連症状 */}
        {relatedSymptoms && relatedSymptoms.length > 0 && (
          <div>
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
