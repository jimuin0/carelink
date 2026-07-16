import { getRankedFacilities } from '@/lib/rankings';
import FacilityCard from '@/components/search/FacilityCard';
import Link from 'next/link';
import type { Metadata } from 'next';
import { prefectures } from '@/lib/constants';

export const revalidate = 3600;

export function generateStaticParams() {
  return prefectures.map((area) => ({ area: encodeURIComponent(area) }));
}

interface Props {
  params: Promise<{ area: string }>;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const area = decodeURIComponent(params.area);
  // ルート layout の title.template '%s | CareLink' が自動付与するため、
  // metadata.title には「| CareLink」を付けない（付けると二重化する）。openGraph.title はテンプレ非適用のため付与する。
  const title = `${area}の人気ランキング`;
  const description = `${area}エリアで口コミ評価の高い美容・医療・福祉施設のランキング。`;
  return {
    title,
    description,
    alternates: { canonical: `/ranking/${params.area}` },
    openGraph: { title: `${title} | CareLink`, description, type: 'website' },
  };
}

export default async function AreaRankingPage(props: Props) {
  const params = await props.params;
  const area = decodeURIComponent(params.area);
  const facilities = await getRankedFacilities(area);

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <nav className="mb-4" aria-label="パンくずリスト">
          <ol className="flex items-center gap-1.5 text-xs text-gray-400">
            <li><Link href="/ranking" className="hover:text-sky-600">ランキング</Link></li>
            <li><span className="mx-1">/</span></li>
            <li className="text-gray-600 font-medium">{area}</li>
          </ol>
        </nav>

        <h1 className="text-2xl font-bold mb-6">{area}の人気ランキング</h1>

        {facilities.length > 0 ? (
          <div className="space-y-4">
            {facilities.map((f, i) => (
              <div key={f.id} className="flex items-start gap-4">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                  i === 0 ? 'bg-yellow-400 text-white' :
                  i === 1 ? 'bg-gray-300 text-white' :
                  i === 2 ? 'bg-amber-600 text-white' :
                  'bg-gray-100 text-gray-500'
                }`}
                  aria-label={`第${i + 1}位`}
                >
                  {i + 1}
                </div>
                <div className="flex-1">
                  <FacilityCard facility={f} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-8 text-center">
            <p className="text-gray-400">このエリアにランキングデータがありません</p>
          </div>
        )}
      </div>
    </div>
  );
}
