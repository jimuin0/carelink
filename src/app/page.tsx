import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import HomeSearchForm from '@/components/search/HomeSearchForm';
import dynamic from 'next/dynamic';

const HomeBelowFold = dynamic(() => import('@/components/home/HomeBelowFold'), {
  ssr: false,
  loading: () => <div className="h-96 bg-gray-50" />,
});

export const metadata: Metadata = {
  title: 'CareLink | ネットでかんたんサロン予約 - ヘア・ネイル・エステ・リラク・美容クリニック',
  description: 'CareLink（ケアリンク）はヘアサロン・ネイル・まつげ・リラク・エステ・美容クリニック・鍼灸院・整骨院を検索・予約できるプラットフォーム。メニュー・料金・口コミで簡単比較。掲載・利用料無料。',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'CareLink | ネットでかんたんサロン予約',
    description: 'ヘア・ネイル・エステ・リラク・美容クリニックを検索・予約。メニュー・料金・口コミで簡単比較。',
    type: 'website',
  },
};

const categories = [
  { name: 'ヘア', type: 'ヘアサロン' },
  { name: 'ネイル・まつげ', type: 'ネイル・まつげサロン' },
  { name: 'リラク', type: 'リラクサロン' },
  { name: 'エステ', type: 'エステサロン' },
  { name: '美容クリニック', type: '美容クリニック' },
];

export const revalidate = 3600;

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      {/* ===== Hero Section ===== */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src="/images/hero.webp"
            alt="CareLink - ネットでかんたんサロン予約"
            fill
            sizes="100vw"
            className="object-cover"
            priority
            placeholder="blur"
            blurDataURL="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwMCIgaGVpZ2h0PSI2MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0iIzBjNGE2ZSIvPjwvc3ZnPg=="
          />
          <div className="absolute inset-0 bg-gradient-to-b from-sky-900/80 via-sky-800/70 to-sky-700/80" />
        </div>

        <div className="relative max-w-[1040px] mx-auto px-4 sm:px-6">
          <div className="pt-10 sm:pt-14 pb-9 sm:pb-12 text-center">
            <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight tracking-wide drop-shadow-sm">
              ネットでかんたんサロン予約
            </h1>
            <p className="text-xs sm:text-sm text-white mt-2 tracking-wider">
              ヘア・ネイル・まつげ・リラク・エステ・美容クリニック
            </p>

            <div className="max-w-[520px] mx-auto mt-5 mb-5">
              <div className="shadow-lg rounded-lg overflow-hidden">
                <HomeSearchForm />
              </div>
            </div>

            <div className="flex items-center justify-center gap-2 flex-wrap max-w-[620px] mx-auto">
              {categories.map((cat) => (
                <Link
                  key={cat.type}
                  href={`/search?type=${encodeURIComponent(cat.type)}`}
                  className="inline-flex items-center gap-1.5 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-full px-4 py-3 text-xs font-medium text-white transition-all shadow-sm hover:shadow min-h-[44px]"
                >
                  <span>{cat.name}</span>
                </Link>
              ))}
            </div>

            <div className="flex items-center justify-center gap-6 sm:gap-10 mt-6">
              <div className="text-center">
                <p className="text-2xl sm:text-3xl font-bold text-white">¥0</p>
                <p className="text-tiny sm:text-xs text-white mt-0.5">掲載・利用料</p>
              </div>
              <div className="w-px h-8 bg-white/20" />
              <div className="text-center">
                <p className="text-2xl sm:text-3xl font-bold text-white">5分</p>
                <p className="text-tiny sm:text-xs text-white mt-0.5">かんたん登録</p>
              </div>
              <div className="w-px h-8 bg-white/20" />
              <div className="text-center">
                <p className="text-2xl sm:text-3xl font-bold text-white">24h</p>
                <p className="text-tiny sm:text-xs text-white mt-0.5">ネット予約対応</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===== 安心ポイント ===== */}
      <div className="bg-white border-t border-gray-100">
        <div className="max-w-[1040px] mx-auto px-4 sm:px-6 py-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-sky-50 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              </div>
              <div>
                <h2 className="text-sm font-bold text-gray-800">完全無料</h2>
                <p className="text-xs text-gray-500 mt-0.5">掲載料・予約手数料は一切かかりません</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-sky-50 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div>
                <h2 className="text-sm font-bold text-gray-800">認証済み施設</h2>
                <p className="text-xs text-gray-500 mt-0.5">運営が確認した施設のみ掲載しています</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-sky-50 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div>
                <h2 className="text-sm font-bold text-gray-800">24時間ネット予約</h2>
                <p className="text-xs text-gray-500 mt-0.5">いつでもどこでもかんたん予約</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===== Below-fold content (client-side loaded) ===== */}
      <HomeBelowFold />
    </div>
  );
}
