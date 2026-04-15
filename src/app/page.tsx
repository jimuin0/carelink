import type { Metadata } from 'next';
import Link from 'next/link';
import HomeSearchForm from '@/components/search/HomeSearchForm';
import dynamic from 'next/dynamic';
import { getPopularFacilities } from '@/lib/facilities';
import FacilityCard from '@/components/search/FacilityCard';

const HomeBelowFold = dynamic(() => import('@/components/home/HomeBelowFold'), {
  ssr: false,
  loading: () => <div className="h-96 bg-gray-50" />,
});

export const metadata: Metadata = {
  title: 'CareLink | ネットでかんたんサロン予約 - ヘア・ネイル・エステ・リラク・美容クリニック',
  description: 'CareLink（ケアリンク）はヘアサロン・ネイル・まつげ・リラク・エステ・美容クリニック・鍼灸院・整骨院を検索・予約できるプラットフォーム。メニュー・料金・口コミで簡単比較。利用料無料。',
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
  { name: '鍼灸院・整骨院', type: '鍼灸院・整骨院' },
  { name: 'ピラティス', type: 'ピラティス' },
];

export const revalidate = 3600;

export default async function Home() {
  const { facilities: popularFacilities } = await getPopularFacilities(6);
  return (
    <div className="min-h-screen bg-white">
      {/* ===== Hero Section ===== */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/hero-tiny.webp"
            alt=""
            fetchPriority="high"
            decoding="async"
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-sky-900/90 via-sky-800/85 to-sky-700/90" />
        </div>

        <div className="relative max-w-[1040px] mx-auto px-4 sm:px-6">
          <div className="pt-10 sm:pt-14 pb-9 sm:pb-12 text-center">
            <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight tracking-wide drop-shadow-md [text-shadow:0_2px_8px_rgba(0,0,0,0.4)]">
              ネットでかんたんサロン予約
            </h1>
            <p className="text-xs sm:text-sm text-white mt-2 tracking-wider [text-shadow:0_1px_4px_rgba(0,0,0,0.3)]">
              ヘア・ネイル・まつげ・リラク・エステ・ピラティス・美容クリニック
            </p>

            <div className="max-w-[520px] mx-auto mt-5">
              <HomeSearchForm />
            </div>

            <div className="flex overflow-x-auto gap-2 mt-4 mb-1 max-w-[620px] mx-auto pb-1 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
              {categories.map((cat) => (
                <Link
                  key={cat.type}
                  href={`/search?type=${encodeURIComponent(cat.type)}`}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-full px-4 py-2.5 text-xs font-medium text-white transition-all shadow-sm hover:shadow whitespace-nowrap min-h-[40px]"
                >
                  {cat.name}
                </Link>
              ))}
            </div>

            <div className="flex items-center justify-center gap-6 sm:gap-10 mt-6">
              <div className="text-center">
                <p className="text-2xl sm:text-3xl font-bold text-white">¥0</p>
                <p className="text-tiny sm:text-xs text-white mt-0.5">予約手数料</p>
              </div>
              <div className="w-px h-8 bg-white/20" />
              <div className="text-center">
                <p className="text-2xl sm:text-3xl font-bold text-white">5分</p>
                <p className="text-tiny sm:text-xs text-white mt-0.5">かんたん予約</p>
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
                <p className="text-xs text-gray-500 mt-0.5">ご予約・ご利用は一切無料です</p>
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

      {/* ===== ユーザーメリット ===== */}
      <div className="bg-gradient-to-r from-sky-50 to-indigo-50 border-t border-sky-100">
        <div className="max-w-[1040px] mx-auto px-4 sm:px-6 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-10">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-white shadow-sm flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-rose-400" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800">お気に入り登録</p>
                  <p className="text-xs text-gray-500">気になるサロンを保存</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-white shadow-sm flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-amber-400" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/><path d="M11.5 6.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5S13.83 5 13 5s-1.5.67-1.5 1.5z" opacity="0"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm.5 14.5h-1v-6h1v6zm0-8h-1v-1h1v1z" opacity="0"/><circle cx="12" cy="12" r="10" fill="none"/><path d="M12 6a1 1 0 100 2 1 1 0 000-2zm0 4a1 1 0 00-1 1v4a1 1 0 002 0v-4a1 1 0 00-1-1z" opacity="0"/><path d="M13.5 9.5c.83 0 1.5-.67 1.5-1.5S14.33 6.5 13.5 6.5 12 7.17 12 8s.67 1.5 1.5 1.5zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-6h2v6h-2zm0-8V7h2v2h-2z" opacity="0"/><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm4.24 16L12 15.45 7.77 18l1.12-4.81-3.73-3.23 4.92-.42L12 5l1.92 4.53 4.92.42-3.73 3.23L16.23 18z"/></svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800">ポイントが貯まる</p>
                  <p className="text-xs text-gray-500">予約するたびにポイント付与</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-white shadow-sm flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-800">予約履歴を管理</p>
                  <p className="text-xs text-gray-500">過去の予約をまとめて確認</p>
                </div>
              </div>
            </div>
            <Link href="/auth/signup" className="shrink-0 inline-flex items-center gap-1.5 px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold rounded-lg transition-colors shadow-sm whitespace-nowrap">
              無料会員登録
            </Link>
          </div>
        </div>
      </div>

      {/* ===== 人気サロン ===== */}
      {popularFacilities.length > 0 && (
        <div className="border-t border-gray-100">
          <div className="max-w-[1040px] mx-auto px-4 sm:px-6 py-8">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-bold text-gray-800 pl-3 border-l-[3px] border-sky-500">人気サロン</h2>
              <Link href="/search?sort=popular" className="text-xs text-sky-600 hover:underline">もっと見る →</Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {popularFacilities.map((facility) => (
                <FacilityCard key={facility.id} facility={facility} showBadges />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== Below-fold content (client-side loaded) ===== */}
      <HomeBelowFold />
    </div>
  );
}
