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

const StickySignupCta = dynamic(() => import('@/components/home/StickySignupCta'), {
  ssr: false,
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

            <div className="flex flex-nowrap overflow-x-auto sm:flex-wrap sm:justify-center gap-2 mt-4 mb-1 max-w-[800px] mx-auto pb-1 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
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

            {/* ★施策1: ヒーロー内登録リンク */}
            <div className="mt-5">
              <Link
                href="/auth/signup"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/25 rounded-full text-white text-xs font-medium transition-all"
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm4.24 16L12 15.45 7.77 18l1.12-4.81-3.73-3.23 4.92-.42L12 5l1.92 4.53 4.92.42-3.73 3.23L16.23 18z"/></svg>
                無料会員登録でポイントGET
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ★施策2: 安心ポイント削除 + CTAバー1本化 */}
      <div className="border-t border-gray-100 bg-white">
        <div className="max-w-[1040px] mx-auto px-4 sm:px-6 py-4">
          <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-6 justify-between">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-5 gap-y-1.5">
              <p className="text-sm font-bold text-gray-800 whitespace-nowrap">無料会員登録で</p>
              <span className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap">
                <span className="w-4 h-4 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center font-bold text-[10px]">✓</span>
                予約ごとにポイント還元
              </span>
              <span className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap">
                <span className="w-4 h-4 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center font-bold text-[10px]">✓</span>
                お気に入りサロンを保存
              </span>
              <span className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap">
                <span className="w-4 h-4 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center font-bold text-[10px]">✓</span>
                予約履歴をかんたん管理
              </span>
            </div>
            <Link
              href="/auth/signup"
              className="shrink-0 inline-flex items-center gap-1.5 px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold rounded-lg transition-colors shadow-sm whitespace-nowrap"
            >
              無料で登録する →
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
            {/* ★施策5: 人気サロン下CTA */}
            <div className="mt-6 pt-6 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-sm text-gray-600">気になるサロンを見つけたら、会員登録してお気に入り保存</p>
              <Link
                href="/auth/signup"
                className="shrink-0 inline-flex items-center gap-1.5 px-5 py-2 border border-sky-600 text-sky-600 hover:bg-sky-50 text-sm font-bold rounded-lg transition-colors whitespace-nowrap"
              >
                無料会員登録はこちら →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ===== Below-fold content (client-side loaded) ===== */}
      <HomeBelowFold />

      {/* ★施策3: スティッキーモバイルCTA */}
      <StickySignupCta />
    </div>
  );
}
