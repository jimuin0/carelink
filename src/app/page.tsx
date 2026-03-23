import Link from 'next/link';
import { regionGroups } from '@/lib/constants';
import HomeSearchForm from '@/components/search/HomeSearchForm';

const categories = [
  {
    name: '美容サロン・アイラッシュ',
    desc: 'まつげパーマ・エクステ、ヘアサロン、ネイルなど',
    gradient: 'from-pink-500 to-rose-400',
  },
  {
    name: '鍼灸院',
    desc: '肩こり・腰痛・自律神経の改善に',
    gradient: 'from-amber-500 to-orange-400',
  },
  {
    name: '整骨院',
    desc: '骨盤矯正・スポーツ外傷・交通事故治療',
    gradient: 'from-sky-500 to-blue-400',
  },
  {
    name: '介護施設・デイサービス',
    desc: '通所介護・リハビリ・機能訓練',
    gradient: 'from-emerald-500 to-green-400',
  },
  {
    name: '病院・クリニック',
    desc: '美容皮膚科・内科・歯科など',
    gradient: 'from-violet-500 to-purple-400',
  },
  {
    name: 'その他',
    desc: 'ヨガ・ピラティス・パーソナルジムなど',
    gradient: 'from-gray-500 to-slate-400',
  },
];

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="relative bg-gradient-to-br from-sky-600 via-sky-500 to-cyan-500 text-white overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute -top-20 -right-20 w-80 h-80 bg-white/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-96 h-96 bg-sky-400/30 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 text-center">
          <p className="text-sky-100 text-sm font-medium tracking-wide mb-3">医療・福祉・美容に特化した検索ポータル</p>
          <h1 className="text-3xl sm:text-4xl font-black mb-3 leading-tight">
            あなたに合った施設が<br />きっと見つかる
          </h1>
          <p className="text-sky-100 mb-8 max-w-lg mx-auto">
            全国のサロン・クリニックをかんたんに検索・比較・予約
          </p>
          <div className="max-w-2xl mx-auto">
            <HomeSearchForm />
          </div>
          <div className="flex justify-center flex-wrap gap-6 mt-6 text-sky-100 text-xs">
            <span className="flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              24時間ネット予約
            </span>
            <span className="flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
              口コミ・評価で比較
            </span>
            <span className="flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              掲載・利用すべて無料
            </span>
          </div>
        </div>
      </section>

      {/* Business Type Cards */}
      <section className="bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <h2 className="font-bold text-xl mb-6">業種から探す</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {categories.map((cat) => (
              <Link
                key={cat.name}
                href={`/search?type=${encodeURIComponent(cat.name)}`}
                className="group relative rounded-2xl overflow-hidden h-36 flex flex-col justify-end"
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${cat.gradient} group-hover:scale-105 transition-transform duration-300`} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                <div className="relative p-5 text-white">
                  <p className="font-bold text-lg leading-tight">{cat.name}</p>
                  <p className="text-white/80 text-xs mt-1">{cat.desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Area Search */}
      <section className="bg-gray-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <h2 className="font-bold text-xl mb-6">エリアから探す</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {regionGroups.map((region) => (
              <Link
                key={region.name}
                href={`/search?area=${encodeURIComponent(region.prefectures[0])}`}
                className="bg-white border border-gray-200 rounded-xl p-5 hover:border-sky-300 hover:shadow-md transition-all group"
              >
                <p className="font-bold text-gray-800 group-hover:text-sky-600 transition-colors">{region.name}</p>
                <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
                  {region.prefectures.slice(0, 5).join(' / ')}
                  {region.prefectures.length > 5 && ' ...'}
                </p>
              </Link>
            ))}
          </div>
          <div className="text-center mt-5">
            <Link href="/search/area" className="text-sm text-sky-600 hover:underline">
              都道府県から探す &rarr;
            </Link>
          </div>
        </div>
      </section>

      {/* Bottom CTA strip */}
      <section className="bg-gray-900 text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:flex items-center justify-between">
          <div>
            <p className="font-bold text-lg">あなたの施設も掲載しませんか？</p>
            <p className="text-gray-400 text-sm mt-1">初期費用・月額費用0円。3分で登録完了。</p>
          </div>
          <Link href="/salon" className="mt-4 sm:mt-0 inline-block px-6 py-3 bg-white text-gray-900 font-bold rounded-lg text-sm hover:bg-gray-100 transition-colors">
            無料で掲載する
          </Link>
        </div>
      </section>
    </>
  );
}
