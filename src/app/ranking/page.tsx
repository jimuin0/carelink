import Link from 'next/link';
import type { Metadata } from 'next';
import { getRankedFacilities } from '@/lib/rankings';
import FacilityCard from '@/components/search/FacilityCard';
import { prefectures } from '@/lib/constants';

export const revalidate = 3600;

export const metadata: Metadata = {
  // ルート layout の title.template '%s | CareLink' が自動付与するため、ここでは「| CareLink」を付けない
  // （付けると <title> が「人気ランキング | CareLink | CareLink」と二重化する。openGraph.title はテンプレ非適用のため付与のまま）。
  title: '人気ランキング',
  description: '口コミ評価の高い美容・医療・福祉施設をランキング形式でご紹介。エリア別のランキングもご覧いただけます。',
  alternates: { canonical: '/ranking' },
  openGraph: {
    title: '人気ランキング | CareLink',
    description: '口コミ評価の高い施設をランキング形式でご紹介',
    type: 'website',
  },
};

export default async function RankingPage() {
  const facilities = await getRankedFacilities();

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold mb-2">人気ランキング</h1>
        <p className="text-sm text-gray-500 mb-6">口コミ評価の高い施設をランキング形式でご紹介</p>

        {/* Prefecture links */}
        <div className="flex flex-wrap gap-2 mb-8">
          {prefectures.slice(0, 10).map((pref) => (
            <Link
              key={pref}
              href={`/ranking/${encodeURIComponent(pref)}`}
              className="text-xs px-3 py-1.5 rounded-full bg-white border border-gray-200 hover:bg-sky-50 hover:text-primary transition-colors"
            >
              {pref}
            </Link>
          ))}
        </div>

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
          /* 【2026年7月30日 是正】ランキングは rating_count > 0 の施設だけを並べるため、
             口コミが1件も無い時期は必ず空になる。旧実装は「ランキングデータがありません」の
             1行で終わっており、次に取れる行動が無い行き止まりだった。/ranking は sitemap に
             含まれ検索エンジンから直接来訪しうるため、そこで離脱させてしまう。
             /search の0件時フォールバックと同じ形に揃え、必ず次の導線を出す。 */
          <div className="bg-white rounded-2xl p-8 text-center">
            <p className="text-gray-700 font-bold mb-1">まだランキングを出せる口コミが集まっていません</p>
            <p className="text-gray-500 text-sm mb-6">
              ランキングは実際に投稿された口コミの評価だけで作成しています。集まり次第ここに掲載します。
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/search"
                className="px-5 py-2.5 bg-sky-700 text-white rounded-lg text-sm font-bold hover:bg-sky-800 transition-colors"
              >
                掲載中の施設を見る
              </Link>
              <Link
                href="/"
                className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-50 transition-colors"
              >
                エリア・症状から探す
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
