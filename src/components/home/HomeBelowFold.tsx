'use client';

import Link from 'next/link';
import Image from 'next/image';
import { regionGroups, facilityFeatures } from '@/lib/constants';
import { getPrefectureSlug, getBusinessTypeSlug } from '@/lib/seo-constants';
import dynamic from 'next/dynamic';

const HomeUserPanel = dynamic(() => import('@/components/search/HomeUserPanel'), { ssr: false });
const JapanRegionMap = dynamic(() => import('@/components/home/JapanRegionMap'), { ssr: false, loading: () => <div className="h-64 bg-gray-50 rounded-2xl animate-pulse" /> });

const categories = [
  { name: 'ヘア', type: 'ヘアサロン' },
  { name: 'ネイル・まつげ', type: 'ネイル・まつげサロン' },
  { name: 'リラク', type: 'リラクサロン' },
  { name: 'エステ', type: 'エステサロン' },
  { name: '美容クリニック', type: '美容クリニック' },
  { name: '鍼灸院・整骨院', type: '鍼灸院・整骨院' },
  { name: 'ピラティス', type: 'ピラティス' },
];

const featureBanners = [
  { title: '春のヘアチェンジ特集', subtitle: 'イメチェンするなら今がチャンス', image: '/images/banner-hair.webp', href: '/search?keyword=ヘアカラー カット', color: 'from-transparent via-transparent to-black/60' },
  { title: '疲れたカラダにご褒美リラク', subtitle: '至福のひとときを見つけよう', image: '/images/banner-relax.webp', href: '/search?type=リラクサロン', color: 'from-transparent via-transparent to-black/60' },
  { title: '理想の目元をつくる', subtitle: 'まつ毛パーマ・エクステ特集', image: '/images/banner-eyelash.webp', href: '/search?type=ネイル・まつげサロン', color: 'from-transparent via-transparent to-black/60' },
];

const worryNavItems = [
  { label: '髪をイメチェンしたい', href: '/search?keyword=ヘアカラー カット' },
  { label: 'まつ毛をぱっちりしたい', href: '/search?type=ネイル・まつげサロン' },
  { label: '肩こり・腰痛がつらい', href: '/search?keyword=肩こり 腰痛 整体' },
  { label: 'お肌をキレイにしたい', href: '/search?type=エステサロン' },
  { label: 'ネイルをおしゃれに', href: '/search?keyword=ネイル ジェル' },
  { label: '日頃の疲れを癒したい', href: '/search?type=リラクサロン' },
];

const majorCities = [
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
];

const blogPosts = [
  { title: 'パリジェンヌラッシュリフトとまつげパーマの違い', slug: 'hal-eyelash-toyonaka-honten', postSlug: 'parisienne-vs-matsuge-perm-2026' },
  { title: '訪問鍼灸の保険適用条件', slug: 'kanbara-shinkyuin-toyonaka', postSlug: 'houmon-shinkyuu-hoken-jouken' },
  { title: '子連れOKのまつげサロンを選ぶポイント', slug: 'hal-eyelash-toyonaka-imai', postSlug: 'koduretok-matsuge-salon-toyonaka' },
];

export default function HomeBelowFold() {
  return (
    <>
      {/* ===== 特集バナー ===== */}
      <div className="bg-gray-50 border-t border-gray-100">
        <div className="max-w-[1040px] mx-auto px-4 sm:px-6 py-6">
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
                  <h2 className="text-white font-bold text-sm sm:text-base leading-tight">{banner.title}</h2>
                  <p className="text-white text-tiny mt-1">{banner.subtitle}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* 新着サロンセクション削除済み（TOPに店舗情報を載せない方針） */}

      {/* ===== お悩み別ナビ ===== */}
      <div className="border-t border-gray-100">
        <div className="max-w-[1040px] mx-auto px-4 sm:px-6 py-6">
          <h2 className="text-sm font-bold text-gray-800 mb-5 pl-3 border-l-[3px] border-sky-500">お悩みから探す</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {worryNavItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="bg-sky-50 rounded-xl px-2 py-3 h-[52px] flex items-center justify-center text-center hover:shadow-md transition-shadow group"
              >
                <span className="text-tiny sm:text-xs font-medium text-gray-700 leading-tight block">{item.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* ===== エリアマップ + テキストナビ ===== */}
      <div className="border-t border-gray-100 bg-gray-50">
        <div className="max-w-[1040px] mx-auto px-4 sm:px-6">
          <div className="flex flex-col md:flex-row gap-6 lg:gap-10 py-8">
            {/* Left: Map */}
            <div className="md:w-[340px] flex-shrink-0">
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
                              <Link href={href} className="text-gray-500 hover:text-sky-700 transition-colors">
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

              {/* 主要都市リンク */}
              <div>
                <h2 className="text-sm font-bold text-gray-800 mb-4 pl-3 border-l-[3px] border-sky-500">主要都市から探す</h2>
                <div className="flex flex-wrap gap-2">
                  {majorCities.map((c) => (
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

              {/* 全47都道府県リンク */}
              <div>
                <h2 className="text-sm font-bold text-gray-800 mb-4 pl-3 border-l-[3px] border-sky-500">都道府県から探す</h2>
                <div className="space-y-3">
                  {regionGroups.map((region) => (
                    <div key={region.name}>
                      <h3 className="text-tiny font-bold text-gray-600 mb-1">{region.name}</h3>
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
            <div className="hidden lg:block w-[200px] flex-shrink-0 space-y-6">
              <HomeUserPanel />
              <nav>
                {[
                  { href: '/mypage/favorites', label: 'お気に入り一覧' },
                  { href: '/contact', label: 'お問い合わせ' },
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

      {/* ===== 施設オーナー向け小リンク ===== */}
      <div className="border-t border-gray-100 bg-gray-50">
        <div className="max-w-[1040px] mx-auto px-4 sm:px-6 py-4 text-center">
          <p className="text-xs text-gray-400">
            施設オーナーの方は
            <Link href="/salon" className="text-sky-600 hover:underline ml-1">
              無料掲載のご案内 →
            </Link>
          </p>
        </div>
      </div>

      {/* ===== コラム・ブログ ===== */}
      <div className="max-w-[1040px] mx-auto px-4 sm:px-6 py-12">
        <h2 className="text-lg sm:text-xl font-bold text-center mb-6">お役立ちコラム</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {blogPosts.map((post) => (
            <Link
              key={post.postSlug}
              href={`/facility/${post.slug}/blog/${post.postSlug}`}
              className="block p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors"
            >
              <p className="text-sm font-medium text-gray-800 line-clamp-2">{post.title}</p>
              <p className="text-xs text-sky-600 mt-2">続きを読む →</p>
            </Link>
          ))}
        </div>
        <div className="text-center mt-4">
          <Link href="/blog" className="text-sm text-sky-600 hover:underline">コラム一覧を見る →</Link>
        </div>
      </div>
    </>
  );
}
