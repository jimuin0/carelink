import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { regionGroups, facilityFeatures } from '@/lib/constants';

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
import { getPrefectureSlug, getBusinessTypeSlug } from '@/lib/seo-constants';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import HomeSearchForm from '@/components/search/HomeSearchForm';
import HomeUserPanel from '@/components/search/HomeUserPanel';
import JapanRegionMap from '@/components/home/JapanRegionMap';
import FacilityCard from '@/components/search/FacilityCard';
import { getLatestFacilities } from '@/lib/facilities';


const categories = [
  {
    name: 'ヘア',
    type: 'ヘアサロン',
    icon: (
      <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" />
      </svg>
    ),
  },
  {
    name: 'ネイル・まつげ',
    type: 'ネイル・まつげサロン',
    icon: (
      <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l2.09 6.26L20 10l-4.74 3.74L17 20l-5-3.5L7 20l1.74-6.26L4 10l5.91-1.74L12 2z" />
      </svg>
    ),
  },
  {
    name: 'リラク',
    type: 'リラクサロン',
    icon: (
      <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 11c-1.5 0-3-1-3-3s2.5-4 4-2c.5.7.7 1.4.7 2" />
        <path d="M17 11c1.5 0 3-1 3-3s-2.5-4-4-2c-.5.7-.7 1.4-.7 2" />
        <path d="M12 11V8c0-1.5-.5-3-2-4" />
        <path d="M12 8c0-1.5.5-3 2-4" />
        <path d="M7 11c0 5 2.5 8 5 10c2.5-2 5-5 5-10" />
      </svg>
    ),
  },
  {
    name: 'エステ',
    type: 'エステサロン',
    icon: (
      <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="9" r="5" />
        <path d="M9.5 7.5c0 0 1-1 2.5-1s2.5 1 2.5 1" />
        <circle cx="10" cy="9" r=".5" fill="currentColor" />
        <circle cx="14" cy="9" r=".5" fill="currentColor" />
        <path d="M10.5 11.5c0 0 .7.5 1.5.5s1.5-.5 1.5-.5" />
        <path d="M12 14v3" />
        <path d="M8 22c0-3 2-5 4-5s4 2 4 5" />
      </svg>
    ),
  },
  {
    name: '美容クリニック',
    type: '美容クリニック',
    icon: (
      <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2C8 2 4 6 4 10c0 5 8 12 8 12s8-7 8-12c0-4-4-8-8-8z" />
        <path d="M12 7v6M9 10h6" />
      </svg>
    ),
  },
];

const featureBanners = [
  {
    title: '春のヘアチェンジ特集',
    subtitle: 'イメチェンするなら今がチャンス',
    image: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?w=600&h=300&fit=crop',
    href: '/search?keyword=ヘアカラー カット',
    color: 'from-transparent via-transparent to-black/60',
  },
  {
    title: '疲れたカラダにご褒美リラク',
    subtitle: '至福のひとときを見つけよう',
    image: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=600&h=300&fit=crop',
    href: '/search?type=リラクサロン',
    color: 'from-transparent via-transparent to-black/60',
  },
  {
    title: '理想の目元をつくる',
    subtitle: 'まつ毛パーマ・エクステ特集',
    image: 'https://images.unsplash.com/photo-1588516903720-8ceb67f9ef84?w=600&h=300&fit=crop',
    href: '/search?type=ネイル・まつげサロン',
    color: 'from-transparent via-transparent to-black/60',
  },
];

const worryNavItems = [
  {
    label: '髪をイメチェンしたい',
    href: '/search?keyword=ヘアカラー カット',
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
        <path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12" />
      </svg>
    ),
  },
  {
    label: 'まつ毛をぱっちりしたい',
    href: '/search?type=ネイル・まつげサロン',
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
  {
    label: '肩こり・腰痛がつらい',
    href: '/search?keyword=肩こり 腰痛 整体',
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 20a6 6 0 00-12 0" /><circle cx="12" cy="10" r="4" />
        <path d="M12 14v2" />
      </svg>
    ),
  },
  {
    label: 'お肌をキレイにしたい',
    href: '/search?type=エステサロン',
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3c-4.97 0-9 4.03-9 9v1c0 1.1.9 2 2 2h1a2 2 0 002-2v-1a2 2 0 00-2-2" />
        <path d="M12 3c4.97 0 9 4.03 9 9v1c0 1.1-.9 2-2 2h-1a2 2 0 01-2-2v-1a2 2 0 012-2" />
        <circle cx="9" cy="10" r="1" fill="currentColor" /><circle cx="15" cy="10" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    label: 'ネイルをおしゃれに',
    href: '/search?keyword=ネイル ジェル',
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l2.09 6.26L20 10l-4.74 3.74L17 20l-5-3.5L7 20l1.74-6.26L4 10l5.91-1.74L12 2z" />
      </svg>
    ),
  },
  {
    label: '日頃の疲れを癒したい',
    href: '/search?type=リラクサロン',
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 11c-1.5 0-3-1-3-3s2.5-4 4-2c.5.7.7 1.4.7 2" />
        <path d="M17 11c1.5 0 3-1 3-3s-2.5-4-4-2c-.5.7-.7 1.4-.7 2" />
        <path d="M12 11V8c0-1.5-.5-3-2-4" /><path d="M12 8c0-1.5.5-3 2-4" />
        <path d="M7 11c0 5 2.5 8 5 10c2.5-2 5-5 5-10" />
      </svg>
    ),
  },
];

export default async function Home() {
  const supabase = createServerSupabaseClient();
  const [{ count: facilityCount }, { count: reviewCount }, { facilities: latestFacilities }] = await Promise.all([
    supabase.from('facility_profiles').select('*', { count: 'exact', head: true }),
    supabase.from('facility_reviews').select('*', { count: 'exact', head: true }),
    getLatestFacilities(6),
  ]);

  return (
    <div className="min-h-screen bg-white">
      {/* ===== Hero Section ===== */}
      <div className="relative overflow-hidden bg-gradient-to-b from-sky-600 to-sky-500">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
            backgroundSize: '24px 24px',
          }}
        />

        <div className="relative max-w-[1040px] mx-auto px-4 sm:px-6">
          <div className="pt-8 sm:pt-10 pb-7 sm:pb-9 text-center">
            <h1 className="text-xl sm:text-2xl font-bold text-white leading-tight tracking-wide">
              ネットでかんたんサロン予約
            </h1>
            <p className="text-tiny sm:text-xs text-sky-100 mt-1.5 tracking-wider">
              ヘア・ネイル・まつげ・リラク・エステ・美容クリニック
            </p>

            <div className="max-w-[520px] mx-auto mt-5 mb-5">
              <div className="shadow-lg rounded-lg overflow-hidden">
                <HomeSearchForm />
              </div>
            </div>

            <div className="flex items-center justify-center gap-2 max-w-[620px] mx-auto">
              {categories.map((cat) => (
                <Link
                  key={cat.type}
                  href={`/search?type=${encodeURIComponent(cat.type)}`}
                  className="inline-flex items-center gap-1.5 bg-white/15 hover:bg-white/25 backdrop-blur-sm rounded-full px-3.5 py-1.5 text-xs font-medium text-white transition-colors"
                >
                  <span className="[&>svg]:w-4 [&>svg]:h-4">{cat.icon}</span>
                  <span>{cat.name}</span>
                </Link>
              ))}
            </div>

            {/* 統計カウンター / 価値訴求 */}
            <div className="flex items-center justify-center gap-6 sm:gap-10 mt-6">
              {(facilityCount ?? 0) >= 50 ? (
                <>
                  <div className="text-center">
                    <p className="text-2xl sm:text-3xl font-bold text-white">{(facilityCount ?? 0).toLocaleString()}</p>
                    <p className="text-micro sm:text-tiny text-sky-100 mt-0.5">掲載施設数</p>
                  </div>
                  <div className="w-px h-8 bg-white/20" />
                  <div className="text-center">
                    <p className="text-2xl sm:text-3xl font-bold text-white">{(reviewCount ?? 0).toLocaleString()}</p>
                    <p className="text-micro sm:text-tiny text-sky-100 mt-0.5">口コミ数</p>
                  </div>
                  <div className="w-px h-8 bg-white/20" />
                  <div className="text-center">
                    <p className="text-2xl sm:text-3xl font-bold text-white">¥0</p>
                    <p className="text-micro sm:text-tiny text-sky-100 mt-0.5">掲載・利用料</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-center">
                    <p className="text-2xl sm:text-3xl font-bold text-white">¥0</p>
                    <p className="text-micro sm:text-tiny text-sky-100 mt-0.5">掲載・利用料</p>
                  </div>
                  <div className="w-px h-8 bg-white/20" />
                  <div className="text-center">
                    <p className="text-2xl sm:text-3xl font-bold text-white">5分</p>
                    <p className="text-micro sm:text-tiny text-sky-100 mt-0.5">かんたん登録</p>
                  </div>
                  <div className="w-px h-8 bg-white/20" />
                  <div className="text-center">
                    <p className="text-2xl sm:text-3xl font-bold text-white">24h</p>
                    <p className="text-micro sm:text-tiny text-sky-100 mt-0.5">ネット予約対応</p>
                  </div>
                </>
              )}
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
                <svg className="w-5 h-5 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-800">完全無料</h3>
                <p className="text-xs text-gray-500 mt-0.5">掲載料・予約手数料は一切かかりません</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-sky-50 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-800">認証済み施設</h3>
                <p className="text-xs text-gray-500 mt-0.5">運営が確認した施設のみ掲載しています</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-sky-50 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-800">24時間ネット予約</h3>
                <p className="text-xs text-gray-500 mt-0.5">いつでもどこでもかんたん予約</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===== 特集バナー ===== */}
      <div className="bg-gray-50 border-t border-gray-100">
        <div className="max-w-[1040px] mx-auto px-4 sm:px-6 py-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {featureBanners.map((banner) => (
              <Link
                key={banner.title}
                href={banner.href}
                className="group relative block rounded-xl overflow-hidden aspect-[2/1] sm:aspect-[4/3]"
              >
                <Image
                  src={banner.image}
                  alt={banner.title}
                  fill
                  sizes="(max-width: 640px) 100vw, 33vw"
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <div className={`absolute inset-0 bg-gradient-to-t ${banner.color}`} />
                <div className="absolute inset-0 flex flex-col justify-end p-4">
                  <h3 className="text-white font-bold text-sm sm:text-base leading-tight">{banner.title}</h3>
                  <p className="text-white/80 text-tiny mt-1">{banner.subtitle}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* ===== 新着サロン ===== */}
      {latestFacilities.length > 0 && (
        <div className="border-t border-gray-100">
          <div className="max-w-[1040px] mx-auto px-4 sm:px-6 py-8">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-bold text-gray-800 pl-3 border-l-[3px] border-sky-500">新着サロン</h2>
              <Link href="/search?sort=newest" className="text-xs text-sky-600 hover:underline">もっと見る &rsaquo;</Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {latestFacilities.map((f) => (
                <FacilityCard key={f.id} facility={f} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== お悩み別ナビ ===== */}
      <div className="border-t border-gray-100">
        <div className="max-w-[1040px] mx-auto px-4 sm:px-6 py-8">
          <h2 className="text-sm font-bold text-gray-800 mb-5 pl-3 border-l-[3px] border-sky-500">お悩みから探す</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {worryNavItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="bg-sky-50 rounded-xl p-4 text-center hover:shadow-md transition-shadow group"
              >
                <div className="text-sky-400 mx-auto mb-2 [&>svg]:mx-auto transition-transform group-hover:scale-110">
                  {item.icon}
                </div>
                <span className="text-tiny sm:text-xs font-medium text-gray-700 leading-tight block">{item.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* ===== エリアマップ + テキストナビ ===== */}
      <div className="border-t border-gray-100 bg-gray-50">
        <div className="max-w-[1040px] mx-auto px-4 sm:px-6">
          <div className="flex flex-col md:flex-row gap-8 py-8">
            {/* Left: Map */}
            <div className="md:w-[400px] flex-shrink-0">
              <h2 className="text-sm font-bold text-gray-800 mb-4 pl-3 border-l-[3px] border-sky-500">エリアから探す</h2>
              <JapanRegionMap />
            </div>

            {/* Center: Category x Area + Features */}
            <div className="flex-1 min-w-0 space-y-8">
              <div>
                <h2 className="text-sm font-bold text-gray-800 mb-4 pl-3 border-l-[3px] border-sky-500">業種 &times; エリアで探す</h2>
                {categories.map((cat, idx) => {
                  const tSlug = getBusinessTypeSlug(cat.type);
                  return (
                    <div key={cat.type} className={`py-3 ${idx < categories.length - 1 ? 'border-b border-gray-100' : ''}`}>
                      <Link
                        href={`/search?type=${encodeURIComponent(cat.type)}`}
                        className="text-sky-700 text-[15px] font-medium hover:underline"
                      >
                        {cat.type}を探す
                      </Link>
                      <div className="flex items-center mt-1.5 whitespace-nowrap">
                        {regionGroups.map((region, i) => {
                          const pSlug = getPrefectureSlug(region.prefectures[0]);
                          const href = pSlug && tSlug
                            ? `/${pSlug}/${tSlug}`
                            : `/search?type=${encodeURIComponent(cat.type)}&area=${encodeURIComponent(region.prefectures[0])}`;
                          return (
                            <span key={region.name} className="text-xs">
                              {i > 0 && <span className="text-gray-200 mx-2">|</span>}
                              <Link
                                href={href}
                                className="text-gray-500 hover:text-sky-700 transition-colors"
                              >
                                {region.name}
                              </Link>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div>
                <h2 className="text-sm font-bold text-gray-800 mb-4 pl-3 border-l-[3px] border-sky-500">こだわり条件から探す</h2>
                <div className="flex flex-wrap gap-2">
                  {facilityFeatures.map((feature) => (
                    <Link
                      key={feature}
                      href={`/search?keyword=${encodeURIComponent(feature)}`}
                      className="px-3.5 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-gray-600 hover:bg-sky-50 hover:border-sky-200 hover:text-sky-700 transition-colors"
                    >
                      {feature}
                    </Link>
                  ))}
                </div>
              </div>

              {/* 主要都市リンク (SEO: 市区町村レベルの内部リンク) */}
              <div>
                <h2 className="text-sm font-bold text-gray-800 mb-4 pl-3 border-l-[3px] border-sky-500">主要都市から探す</h2>
                <div className="flex flex-wrap gap-2">
                  {[
                    { pref: 'tokyo', slug: 'shibuya', name: '渋谷区' },
                    { pref: 'tokyo', slug: 'shinjuku', name: '新宿区' },
                    { pref: 'tokyo', slug: 'minato', name: '港区' },
                    { pref: 'tokyo', slug: 'setagaya', name: '世田谷区' },
                    { pref: 'tokyo', slug: 'meguro', name: '目黒区' },
                    { pref: 'osaka', slug: 'kita', name: '大阪北区' },
                    { pref: 'osaka', slug: 'chuo', name: '大阪中央区' },
                    { pref: 'osaka', slug: 'tennoji', name: '天王寺区' },
                    { pref: 'kanagawa', slug: 'yokohama-nishi', name: '横浜市西区' },
                    { pref: 'aichi', slug: 'nagoya-naka', name: '名古屋市中区' },
                    { pref: 'fukuoka', slug: 'hakata', name: '博多区' },
                    { pref: 'hokkaido', slug: 'sapporo', name: '札幌市' },
                    { pref: 'miyagi', slug: 'sendai', name: '仙台市' },
                    { pref: 'hiroshima', slug: 'hiroshima-naka', name: '広島市中区' },
                    { pref: 'kyoto', slug: 'shimogyo', name: '京都下京区' },
                  ].map((c) => (
                    <Link
                      key={`${c.pref}-${c.slug}`}
                      href={`/${c.pref}/${c.slug}`}
                      className="px-3.5 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-gray-600 hover:bg-sky-50 hover:border-sky-200 hover:text-sky-700 transition-colors"
                    >
                      {c.name}
                    </Link>
                  ))}
                </div>
              </div>

              {/* 全47都道府県リンク (SEO: 内部リンク増加) */}
              <div>
                <h2 className="text-sm font-bold text-gray-800 mb-4 pl-3 border-l-[3px] border-sky-500">都道府県から探す</h2>
                <div className="space-y-3">
                  {regionGroups.map((region) => (
                    <div key={region.name}>
                      <h3 className="text-tiny font-bold text-gray-500 mb-1">{region.name}</h3>
                      <div className="flex items-center whitespace-nowrap">
                        {region.prefectures.map((pref, i) => {
                          const pSlug = getPrefectureSlug(pref);
                          return (
                            <span key={pref} className="text-xs">
                              {i > 0 && <span className="text-gray-200 mx-2">|</span>}
                              <Link href={pSlug ? `/${pSlug}` : `/search?area=${encodeURIComponent(pref)}`} className="text-gray-600 hover:text-sky-700 transition-colors">{pref}</Link>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: User panel */}
            <div className="md:w-[200px] flex-shrink-0 space-y-6">
              <HomeUserPanel />
              <nav>
                {[
                  { href: '/mypage/favorites', label: 'お気に入り一覧' },
                  { href: '/contact', label: 'よくある質問' },
                  { href: '/contact', label: 'ヘルプ' },
                ].map((item) => (
                  <Link
                    key={`${item.href}-${item.label}`}
                    href={item.href}
                    className="flex items-center justify-between py-3 text-xs text-gray-500 hover:text-sky-700 transition-colors border-b border-gray-100"
                  >
                    <span>{item.label}</span>
                    <span className="text-gray-400">&rsaquo;</span>
                  </Link>
                ))}
              </nav>
            </div>
          </div>
        </div>
      </div>
      {/* ===== 施設オーナー向けCTA ===== */}
      <div className="bg-gradient-to-r from-sky-600 to-indigo-600">
        <div className="max-w-[1040px] mx-auto px-4 sm:px-6 py-10 text-center">
          <h2 className="text-lg font-bold text-white">施設を掲載しませんか？</h2>
          <p className="text-sm text-sky-100 mt-2">掲載料無料。新規のお客様にあなたの施設を知ってもらいましょう。</p>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 mt-4 px-8 py-3 bg-white text-sky-600 font-bold rounded-lg hover:bg-sky-50 transition-colors"
          >
            無料で掲載する
          </Link>
        </div>
      </div>
    </div>
  );
}
